$f = "e:\28 ebpf_exporter\mw-admin\backend\internal\services\zk_sasl.go"
$txt = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)

# Fix 1 – Add readOnly=false bool to ConnectRequest so the server treats us as
# a new-style (ZK 3.4+) client.  Old-client sessions with sessionRequireClientSASLAuth
# can be immediately invalidated by ZK 3.9 before we get to send opcode 200.
$old1 = "juteWriteBytes(&req, make([]byte, 16)) // Password`r`n`tif err = zkSendPkt(conn, req.Bytes()); err != nil {"
$new1 = "juteWriteBytes(&req, make([]byte, 16)) // Password`r`n`tjuteWriteBool(&req, false)             // readOnly=false (new-client format required for SASL in ZK 3.6+)`r`n`tif err = zkSendPkt(conn, req.Bytes()); err != nil {"
if ($txt.Contains($old1)) {
    $txt = $txt.Replace($old1, $new1); Write-Host "Fix1 applied (CRLF)"
} else {
    $old1 = $old1.Replace("`r`n", "`n")
    $new1 = $new1.Replace("`r`n", "`n")
    $txt = $txt.Replace($old1, $new1); Write-Host "Fix1 applied (LF)"
}

# Fix 2 – DIGEST-MD5 initial token must be nil (jute int32=-1 = null buffer)
# not []byte{} (jute int32=0 = empty buffer).  The ZK Java client sends null.
$old2 = "challenge, err := zkSASLExchange(conn, []byte{})"
$new2 = "challenge, err := zkSASLExchange(conn, nil) // nil=null buffer; ZK Java client sends no initial response for DIGEST-MD5"
if ($txt.Contains($old2)) { $txt = $txt.Replace($old2, $new2); Write-Host "Fix2 applied" } else { Write-Host "Fix2 NOT found" }

# Fix 3 – Remove stale host/server variable (server param was removed) and set correct digestURI.
# ZK Java client uses Sasl.createSaslClient("DIGEST-MD5",null,"zookeeper","zookeeper",...)
# so digest-uri = "zookeeper/zookeeper".
$old3a = "`thost := server`r`n`tif idx := strings.LastIndex(host, `":`"); idx >= 0 {`r`n`t`thost = host[:idx]`r`n`t}`r`n`tdigestURI := `"zookeeper/`" + host"
$new3 = "`t// ZK Java client uses protocol=`"zookeeper`", serverName=`"zookeeper`" (sasl.client.username default)`r`n`tdigestURI := `"zookeeper/zookeeper`""
if ($txt.Contains($old3a)) {
    $txt = $txt.Replace($old3a, $new3); Write-Host "Fix3 applied (CRLF)"
} else {
    $old3b = $old3a.Replace("`r`n", "`n")
    if ($txt.Contains($old3b)) {
        $txt = $txt.Replace($old3b, $new3.Replace("`r`n","`n")); Write-Host "Fix3 applied (LF)"
    } else {
        Write-Host "Fix3 NOT found - checking for partial..."
        if ($txt -match "host := server") { Write-Host "  'host := server' found" } else { Write-Host "  'host := server' NOT found" }
        if ($txt -match "digestURI := `"zookeeper/`" \+ host") { Write-Host "  old digestURI found" }
        if ($txt -match 'digestURI := "zookeeper/zookeeper"') { Write-Host "  new digestURI already present" }
    }
}

[System.IO.File]::WriteAllText($f, $txt, (New-Object System.Text.UTF8Encoding $false))
Write-Host "File written."
