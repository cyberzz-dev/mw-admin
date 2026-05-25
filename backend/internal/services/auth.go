package services

import (
	"errors"
	"mw-admin/internal/config"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func jwtSecret() []byte {
	return []byte(config.Global.Auth.JWTSecret)
}

func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(bytes), err
}

func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

type Claims struct {
	UserID          uint   `json:"user_id"`
	Username        string `json:"username"`
	Role            string `json:"role"`
	Permissions     string `json:"permissions"`
	ViewScope       string `json:"view_scope"`
	ComponentAccess string `json:"component_access"` // JSON array of allowed components; empty = all
	jwt.RegisteredClaims
}

func GenerateToken(userID uint, username, role, permissions, viewScope, componentAccess string) (string, error) {
	expireHours := time.Duration(config.Global.Auth.JWTExpireHours) * time.Hour
	claims := Claims{
		UserID:          userID,
		Username:        username,
		Role:            role,
		Permissions:     permissions,
		ViewScope:       viewScope,
		ComponentAccess: componentAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expireHours)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret())
}

func ParseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return jwtSecret(), nil
	})
	if err != nil {
		return nil, err
	}
	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("invalid token")
}
