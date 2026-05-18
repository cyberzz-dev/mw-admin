// Package services �?custom ZooKeeper client with SASL support.
//
// The go-zookeeper/zk library only implements opcode 100 (AddAuth) and does
// not implement opcode 200 (SASL handshake).  ZooKeeper clusters configured
// with requireClientAuthScheme=sasl require the proper SASL exchange using
// opcode 200, so we implement that exchange here with a lightweight raw-TCP
// client that speaks the ZK binary (jute) protocol directly.
//
// Supported SASL mechanisms:
//   - PLAIN         �?single round-trip, username + password
//   - DIGEST-MD5    �?two round-trips, challenge/response per RFC 2831
package services

import (
	"bytes"
	"crypto/md5" //nolint:gosec // DIGEST-MD5 is mandated by the ZK SASL protocol
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"mw-admin/internal/models"
	"net"
	"sort"
	"strings"
	"time"

	"github.com/go-zookeeper/zk"
)

// ─── ZK opcode / constant ────────────────────────────────────────────────────

const (
	zkOpCreate       int32 = 1
	zkOpDelete       int32 = 2
	zkOpGetData      int32 = 4
	zkOpSetData      int32 = 5
	zkOpGetACL       int32 = 6
	zkOpSetACL       int32 = 7
	zkOpGetChildren2 int32 = 12
	// ZooDefs.OpCode.sasl = 102 (ZK 3.8.6 ZooDefs.java).
	// Opcode 200 does NOT exist; using it causes the server to fall through
	// to its "enforceAuthentication" check which returns -124 (SESSIONCLOSEDREQUIRESASLAUTH).
	zkOpSASL int32 = 102

	zkXIDSASL int32 = -4 // conventional XID for auth/SASL packets
)

// ─── Jute (ZK binary protocol) encoding ──────────────────────────────────────

func juteWriteInt32(w *bytes.Buffer, v int32) {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], uint32(v))
	w.Write(b[:])
}

func juteWriteInt64(w *bytes.Buffer, v int64) {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(v))
	w.Write(b[:])
}

func juteWriteString(w *bytes.Buffer, s string) {
	juteWriteInt32(w, int32(len(s)))
	w.WriteString(s)
}

func juteWriteBytes(w *bytes.Buffer, b []byte) {
	if b == nil {
		juteWriteInt32(w, -1)
		return
	}
	juteWriteInt32(w, int32(len(b)))
	w.Write(b)
}

func juteWriteBool(w *bytes.Buffer, v bool) {
	if v {
		w.WriteByte(1)
	} else {
		w.WriteByte(0)
	}
}

func juteReadInt32(buf []byte) (int32, []byte, error) {
	if len(buf) < 4 {
		return 0, nil, io.ErrUnexpectedEOF
	}
	return int32(binary.BigEndian.Uint32(buf[:4])), buf[4:], nil
}

func juteReadInt64(buf []byte) (int64, []byte, error) {
	if len(buf) < 8 {
		return 0, nil, io.ErrUnexpectedEOF
	}
	return int64(binary.BigEndian.Uint64(buf[:8])), buf[8:], nil
}

func juteReadString(buf []byte) (string, []byte, error) {
	n, rest, err := juteReadInt32(buf)
	if err != nil {
		return "", nil, err
	}
	if n < 0 {
		return "", rest, nil
	}
	if len(rest) < int(n) {
		return "", nil, io.ErrUnexpectedEOF
	}
	return string(rest[:n]), rest[n:], nil
}

func juteReadBytes(buf []byte) ([]byte, []byte, error) {
	n, rest, err := juteReadInt32(buf)
	if err != nil {
		return nil, nil, err
	}
	if n < 0 {
		return nil, rest, nil
	}
	if len(rest) < int(n) {
		return nil, nil, io.ErrUnexpectedEOF
	}
	return append([]byte(nil), rest[:n]...), rest[n:], nil
}

func juteReadBool(buf []byte) (bool, []byte, error) {
	if len(buf) < 1 {
		return false, nil, io.ErrUnexpectedEOF
	}
	return buf[0] != 0, buf[1:], nil
}

// ─── ZK Stat ─────────────────────────────────────────────────────────────────

func juteReadStat(buf []byte) (*zk.Stat, []byte, error) {
	s := &zk.Stat{}
	var err error
	var v32 int32
	if s.Czxid, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	if s.Mzxid, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	if s.Ctime, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	if s.Mtime, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	if v32, buf, err = juteReadInt32(buf); err != nil {
		return nil, nil, err
	}
	s.Version = v32
	if v32, buf, err = juteReadInt32(buf); err != nil {
		return nil, nil, err
	}
	s.Cversion = v32
	if v32, buf, err = juteReadInt32(buf); err != nil {
		return nil, nil, err
	}
	s.Aversion = v32
	if s.EphemeralOwner, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	if v32, buf, err = juteReadInt32(buf); err != nil {
		return nil, nil, err
	}
	s.DataLength = v32
	if v32, buf, err = juteReadInt32(buf); err != nil {
		return nil, nil, err
	}
	s.NumChildren = v32
	if s.Pzxid, buf, err = juteReadInt64(buf); err != nil {
		return nil, nil, err
	}
	return s, buf, nil
}

// ─── ZK ACL ──────────────────────────────────────────────────────────────────

func juteReadACL(buf []byte) (zk.ACL, []byte, error) {
	perms, rest, err := juteReadInt32(buf)
	if err != nil {
		return zk.ACL{}, nil, err
	}
	scheme, rest, err := juteReadString(rest)
	if err != nil {
		return zk.ACL{}, nil, err
	}
	id, rest, err := juteReadString(rest)
	if err != nil {
		return zk.ACL{}, nil, err
	}
	return zk.ACL{Perms: perms, Scheme: scheme, ID: id}, rest, nil
}

func juteReadACLList(buf []byte) ([]zk.ACL, []byte, error) {
	count, rest, err := juteReadInt32(buf)
	if err != nil {
		return nil, nil, err
	}
	if count < 0 {
		return nil, rest, nil
	}
	acls := make([]zk.ACL, count)
	for i := range acls {
		if acls[i], rest, err = juteReadACL(rest); err != nil {
			return nil, nil, err
		}
	}
	return acls, rest, nil
}

func juteWriteACL(w *bytes.Buffer, acl zk.ACL) {
	juteWriteInt32(w, acl.Perms)
	juteWriteString(w, acl.Scheme)
	juteWriteString(w, acl.ID)
}

func juteWriteACLList(w *bytes.Buffer, acls []zk.ACL) {
	juteWriteInt32(w, int32(len(acls)))
	for _, a := range acls {
		juteWriteACL(w, a)
	}
}

// ─── ZK packet framing ───────────────────────────────────────────────────────

func zkSendPkt(conn net.Conn, data []byte) error {
	hdr := make([]byte, 4)
	binary.BigEndian.PutUint32(hdr, uint32(len(data)))
	if _, err := conn.Write(hdr); err != nil {
		return err
	}
	_, err := conn.Write(data)
	return err
}

func zkRecvPkt(conn net.Conn) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(conn, hdr[:]); err != nil {
		return nil, err
	}
	n := int(binary.BigEndian.Uint32(hdr[:]))
	if n > 16*1024*1024 {
		return nil, fmt.Errorf("zk: response packet too large (%d bytes)", n)
	}
	buf := make([]byte, n)
	_, err := io.ReadFull(conn, buf)
	return buf, err
}

// ─── Connect handshake ───────────────────────────────────────────────────────

func zkHandshake(conn net.Conn) (sessionID int64, passwd []byte, err error) {
	var req bytes.Buffer
	juteWriteInt32(&req, 0)                // ProtocolVersion
	juteWriteInt64(&req, 0)                // LastZxidSeen
	juteWriteInt32(&req, 30000)            // SessionTimeoutMs
	juteWriteInt64(&req, 0)                // SessionID (0 = new)
	juteWriteBytes(&req, make([]byte, 16)) // Password
	juteWriteBool(&req, false)             // readOnly=false (new-client format; required for SASL in ZK 3.6+)
	if err = zkSendPkt(conn, req.Bytes()); err != nil {
		return
	}
	var data []byte
	if data, err = zkRecvPkt(conn); err != nil {
		return
	}
	// ConnectResponse: int32(pv) + int32(timeout) + int64(sessionID) + []byte(passwd)
	var rest []byte
	var pv, tmOut int32
	if pv, rest, err = juteReadInt32(data); err != nil {
		return
	}
	_ = pv
	if tmOut, rest, err = juteReadInt32(rest); err != nil {
		return
	}
	_ = tmOut
	if sessionID, rest, err = juteReadInt64(rest); err != nil {
		return
	}
	passwd, _, err = juteReadBytes(rest)
	if err != nil {
		return
	}
	if sessionID == 0 {
		err = fmt.Errorf("zk: server rejected the connection (sessionID=0)")
	}
	return
}

// ─── Response header ─────────────────────────────────────────────────────────

func zkParseHeader(buf []byte) (xid int32, zxid int64, errCode int32, rest []byte, err error) {
	xid, rest, err = juteReadInt32(buf)
	if err != nil {
		return
	}
	zxid, rest, err = juteReadInt64(rest)
	if err != nil {
		return
	}
	errCode, rest, err = juteReadInt32(rest)
	return
}

var zkErrMap = map[int32]error{
	-101: zk.ErrNoNode,
	-102: zk.ErrNoAuth,
	-103: zk.ErrBadVersion,
	-110: zk.ErrNodeExists,
	-111: zk.ErrNotEmpty,
	-112: zk.ErrSessionExpired,
	-114: zk.ErrInvalidACL,
	-115: zk.ErrAuthFailed,
	-118: zk.ErrNoChildrenForEphemerals,
}

func zkErr(code int32) error {
	if code == 0 {
		return nil
	}
	if e, ok := zkErrMap[code]; ok {
		return e
	}
	return fmt.Errorf("zk: error code %d", code)
}

// ─── SASL handshake (opcode 200) ─────────────────────────────────────────────

// zkSASLExchange sends one SASL packet (opcode 200) and returns the server's
// response token (may be empty on success).
func zkSASLExchange(conn net.Conn, token []byte) ([]byte, error) {
	var body bytes.Buffer
	juteWriteBytes(&body, token)

	var pkt bytes.Buffer
	juteWriteInt32(&pkt, zkXIDSASL)
	juteWriteInt32(&pkt, zkOpSASL)
	pkt.Write(body.Bytes())

	conn.SetDeadline(time.Now().Add(zkTimeout)) //nolint:errcheck
	defer conn.SetDeadline(time.Time{})         //nolint:errcheck

	if err := zkSendPkt(conn, pkt.Bytes()); err != nil {
		return nil, fmt.Errorf("sasl send: %w", err)
	}
	data, err := zkRecvPkt(conn)
	if err != nil {
		return nil, fmt.Errorf("sasl recv: %w", err)
	}
	_, _, errCode, rest, err := zkParseHeader(data)
	if err != nil {
		return nil, fmt.Errorf("sasl parse header: %w", err)
	}
	if errCode != 0 {
		return nil, fmt.Errorf("sasl authentication rejected by server: %w", zkErr(errCode))
	}
	// SetSASLResponse body: Buffer token
	respToken, _, err := juteReadBytes(rest)
	return respToken, err
}

// zkSASLPlain performs SASL/PLAIN authentication.
// Token format (RFC 4616): \x00 authcid \x00 passwd
func zkSASLPlain(conn net.Conn, username, password string) error {
	token := []byte("\x00" + username + "\x00" + password)
	_, err := zkSASLExchange(conn, token)
	if err != nil {
		return fmt.Errorf("sasl/plain: %w", err)
	}
	return nil
}

// zkSASLDigestMD5 performs SASL/DIGEST-MD5 authentication per RFC 2831.
// server is the "host:port" string of the ZK node we connected to.
func zkSASLDigestMD5(conn net.Conn, username, password string) error {
	// Step 1 – send empty initial message; server replies with challenge.
	// DIGEST-MD5 is server-first: client sends no initial response token.
	// ZK 3.8.6 ZooKeeperSaslClient.initialize(): when hasInitialResponse()==false,
	// it sends new byte[0] (empty array, Jute int32=0), NOT null (Jute int32=-1).
	// Sending null causes clientToken.length NPE on the server → session closed with -124.
	challenge, err := zkSASLExchange(conn, []byte{})
	if err != nil {
		return fmt.Errorf("sasl/digest-md5 step1: %w", err)
	}
	if len(challenge) == 0 {
		return fmt.Errorf("sasl/digest-md5: server sent empty challenge")
	}

	params := parseSASLKV(string(challenge))
	nonce := params["nonce"]
	realm := params["realm"]
	// Pick qop=auth (we don't support auth-int / auth-conf).
	cnonce := saslCNonce()
	nc := "00000001"
	// ZK 3.8+ server creates: SecurityUtils.createSaslServer(subject, "zookeeper", "zk-sasl-md5", ...)
	// ZK 3.8+ client creates: SecurityUtils.createSaslClient(config, subject, gssapiPrincipal, "zookeeper", "zk-sasl-md5", ...)
	// Both map to Sasl.createSasl{Server,Client}("DIGEST-MD5", protocol="zookeeper", serverName="zk-sasl-md5", ...)
	// → digest-uri = "zookeeper/zk-sasl-md5"; realm in challenge also defaults to serverName = "zk-sasl-md5".
	// OpenJDK DigestMD5Server throws SaslException on mismatch, so this value must be exact.
	digestURI := "zookeeper/zk-sasl-md5"

	// Compute per RFC 2831 with algorithm=md5-sess:
	//   A1 raw = MD5(username:realm:password)
	//   HA1     = hex( MD5( A1_raw || ":" || nonce || ":" || cnonce ) )
	//   HA2     = hex( MD5( "AUTHENTICATE:" || digestURI ) )
	//   resp    = hex( MD5( HA1 || ":" || nonce || ":" || nc || ":" || cnonce || ":auth:" || HA2 ) )
	a1Raw := md5.Sum([]byte(username + ":" + realm + ":" + password)) //nolint:gosec
	a1Input := append(a1Raw[:], []byte(":"+nonce+":"+cnonce)...)
	ha1Sum := md5.Sum(a1Input) //nolint:gosec
	ha1 := hex.EncodeToString(ha1Sum[:])

	ha2Input := "AUTHENTICATE:" + digestURI
	ha2Sum := md5.Sum([]byte(ha2Input)) //nolint:gosec
	ha2 := hex.EncodeToString(ha2Sum[:])

	respInput := ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + ha2
	respSum := md5.Sum([]byte(respInput)) //nolint:gosec
	response := hex.EncodeToString(respSum[:])

	clientResponse := fmt.Sprintf(
		`charset=utf-8,cnonce="%s",digest-uri="%s",nc=%s,nonce="%s",qop=auth,realm="%s",response=%s,username="%s"`,
		cnonce, digestURI, nc, nonce, realm, response, username,
	)

	// Step 2 �?send computed response; server replies with rspauth (or error).
	// Include diagnostic context so a mismatch error is easy to trace.
	if _, err = zkSASLExchange(conn, []byte(clientResponse)); err != nil {
		return fmt.Errorf("sasl/digest-md5 step2 (realm=%q, digest-uri=%q): %w", realm, digestURI, err)
	}
	return nil
}

// parseSASLKV parses SASL challenge/response key=value pairs, handling quoted values.
func parseSASLKV(s string) map[string]string {
	params := make(map[string]string)
	s = strings.TrimSpace(s)
	for len(s) > 0 {
		// Skip leading commas and whitespace between key-value pairs.
		s = strings.TrimLeft(strings.TrimSpace(s), ",")
		s = strings.TrimSpace(s)
		eqIdx := strings.IndexByte(s, '=')
		if eqIdx < 0 {
			break
		}
		key := strings.TrimSpace(s[:eqIdx])
		s = s[eqIdx+1:]
		var val string
		if len(s) > 0 && s[0] == '"' {
			s = s[1:]
			end := strings.IndexByte(s, '"')
			if end < 0 {
				val = s
				s = ""
			} else {
				val = s[:end]
				s = s[end+1:]
			}
		} else {
			commaIdx := strings.IndexByte(s, ',')
			if commaIdx < 0 {
				val = s
				s = ""
			} else {
				val = s[:commaIdx]
				s = s[commaIdx+1:]
			}
		}
		params[key] = val
	}
	return params
}

func saslCNonce() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// ─── zkConn interface ─────────────────────────────────────────────────────────
//
// *zk.Conn satisfies this interface automatically via Go's structural typing.
// saslZKConn also satisfies it via the methods below.

type zkConn interface {
	Children(path string) ([]string, *zk.Stat, error)
	Get(path string) ([]byte, *zk.Stat, error)
	Set(path string, data []byte, version int32) (*zk.Stat, error)
	Create(path string, data []byte, flags int32, acl []zk.ACL) (string, error)
	Delete(path string, version int32) error
	GetACL(path string) ([]zk.ACL, *zk.Stat, error)
	SetACL(path string, acl []zk.ACL, version int32) (*zk.Stat, error)
	Close()
}

// Compile-time verification.
var (
	_ zkConn = (*zk.Conn)(nil)
	_ zkConn = (*saslZKConn)(nil)
)

// ─── saslZKConn ──────────────────────────────────────────────────────────────

// saslZKConn is a minimal, synchronous ZooKeeper client that uses a raw TCP
// connection (already SASL-authenticated) to execute ZK operations.
type saslZKConn struct {
	conn net.Conn
	xid  int32
}

func (c *saslZKConn) nextXID() int32 {
	c.xid++
	return c.xid
}

func (c *saslZKConn) do(opcode int32, body *bytes.Buffer) ([]byte, error) {
	var pkt bytes.Buffer
	juteWriteInt32(&pkt, c.nextXID())
	juteWriteInt32(&pkt, opcode)
	if body != nil {
		pkt.Write(body.Bytes())
	}
	c.conn.SetDeadline(time.Now().Add(zkTimeout)) //nolint:errcheck
	defer c.conn.SetDeadline(time.Time{})         //nolint:errcheck
	if err := zkSendPkt(c.conn, pkt.Bytes()); err != nil {
		return nil, err
	}
	data, err := zkRecvPkt(c.conn)
	if err != nil {
		return nil, err
	}
	_, _, errCode, rest, err := zkParseHeader(data)
	if err != nil {
		return nil, err
	}
	if errCode != 0 {
		return nil, zkErr(errCode)
	}
	return rest, nil
}

func (c *saslZKConn) Close() { c.conn.Close() }

func (c *saslZKConn) Children(path string) ([]string, *zk.Stat, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteBool(&req, false)
	body, err := c.do(zkOpGetChildren2, &req)
	if err != nil {
		return nil, nil, err
	}
	count, rest, err := juteReadInt32(body)
	if err != nil {
		return nil, nil, err
	}
	children := make([]string, 0, count)
	for i := int32(0); i < count; i++ {
		var child string
		child, rest, err = juteReadString(rest)
		if err != nil {
			return nil, nil, err
		}
		children = append(children, child)
	}
	sort.Strings(children)
	stat, _, err := juteReadStat(rest)
	return children, stat, err
}

func (c *saslZKConn) Get(path string) ([]byte, *zk.Stat, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteBool(&req, false)
	body, err := c.do(zkOpGetData, &req)
	if err != nil {
		return nil, nil, err
	}
	data, rest, err := juteReadBytes(body)
	if err != nil {
		return nil, nil, err
	}
	stat, _, err := juteReadStat(rest)
	return data, stat, err
}

func (c *saslZKConn) Set(path string, data []byte, version int32) (*zk.Stat, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteBytes(&req, data)
	juteWriteInt32(&req, version)
	body, err := c.do(zkOpSetData, &req)
	if err != nil {
		return nil, err
	}
	stat, _, err := juteReadStat(body)
	return stat, err
}

func (c *saslZKConn) Create(path string, data []byte, flags int32, acl []zk.ACL) (string, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteBytes(&req, data)
	juteWriteACLList(&req, acl)
	juteWriteInt32(&req, flags)
	body, err := c.do(zkOpCreate, &req)
	if err != nil {
		return "", err
	}
	created, _, err := juteReadString(body)
	return created, err
}

func (c *saslZKConn) Delete(path string, version int32) error {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteInt32(&req, version)
	_, err := c.do(zkOpDelete, &req)
	return err
}

func (c *saslZKConn) GetACL(path string) ([]zk.ACL, *zk.Stat, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	body, err := c.do(zkOpGetACL, &req)
	if err != nil {
		return nil, nil, err
	}
	acls, rest, err := juteReadACLList(body)
	if err != nil {
		return nil, nil, err
	}
	stat, _, err := juteReadStat(rest)
	return acls, stat, err
}

func (c *saslZKConn) SetACL(path string, acl []zk.ACL, version int32) (*zk.Stat, error) {
	var req bytes.Buffer
	juteWriteString(&req, path)
	juteWriteACLList(&req, acl)
	juteWriteInt32(&req, version)
	body, err := c.do(zkOpSetACL, &req)
	if err != nil {
		return nil, err
	}
	stat, _, err := juteReadStat(body)
	return stat, err
}

// ─── Constructor ─────────────────────────────────────────────────────────────

// newSASLZKConn dials a ZooKeeper server and completes the SASL handshake.
// It tries each configured server in order and returns on the first success.
func newSASLZKConn(cluster *models.ZKCluster) (zkConn, error) {
	servers := strings.Split(cluster.Servers, ",")
	mechanism := strings.ToUpper(strings.TrimSpace(cluster.SASLMechanism))
	if mechanism == "" {
		mechanism = "DIGEST-MD5"
	}

	var lastErr error
	for _, srv := range servers {
		srv = strings.TrimSpace(srv)
		c, err := net.DialTimeout("tcp", srv, zkTimeout)
		if err != nil {
			lastErr = fmt.Errorf("dial %s: %w", srv, err)
			continue
		}
		c.SetDeadline(time.Now().Add(zkTimeout)) //nolint:errcheck

		_, _, err = zkHandshake(c)
		if err != nil {
			c.Close()
			lastErr = fmt.Errorf("connect to %s: %w", srv, err)
			continue
		}
		c.SetDeadline(time.Time{}) //nolint:errcheck

		switch mechanism {
		case "PLAIN":
			err = zkSASLPlain(c, cluster.Username, cluster.Password)
		case "DIGEST-MD5":
			err = zkSASLDigestMD5(c, cluster.Username, cluster.Password)
		default:
			c.Close()
			return nil, fmt.Errorf("unsupported SASL mechanism %q", mechanism)
		}
		if err != nil {
			c.Close()
			lastErr = fmt.Errorf("sasl auth to %s: %w", srv, err)
			continue
		}

		return &saslZKConn{conn: c, xid: 0}, nil
	}
	return nil, fmt.Errorf("could not connect to ZooKeeper: %w", lastErr)
}
