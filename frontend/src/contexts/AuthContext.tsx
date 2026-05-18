import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

export interface CurrentUser {
  id: number
  username: string
  role: 'admin' | 'user'
  permissions: string[] // array of permission strings
  view_scope: 'all' | 'own'
}

interface AuthContextValue {
  user: CurrentUser | null
  token: string | null
  login: (token: string, user: CurrentUser) => void
  logout: () => void
  hasPermission: (perm: string) => boolean
  isAdmin: boolean
  isOwnScopeUser: boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  hasPermission: () => false,
  isAdmin: false,
  isOwnScopeUser: false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('mw_token'))
  const [user, setUser] = useState<CurrentUser | null>(() => {
    const u = localStorage.getItem('mw_user')
    if (u) {
      try { return JSON.parse(u) } catch { return null }
    }
    return null
  })

  const login = useCallback((tk: string, u: CurrentUser) => {
    setToken(tk)
    setUser(u)
    localStorage.setItem('mw_token', tk)
    localStorage.setItem('mw_user', JSON.stringify(u))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('mw_token')
    localStorage.removeItem('mw_user')
  }, [])

  const isAdmin = user?.role === 'admin'
  const isOwnScopeUser = !isAdmin && user?.view_scope === 'own'

  const hasPermission = useCallback((perm: string): boolean => {
    if (!user) return false
    if (user.role === 'admin') return true
    return (user.permissions || []).includes(perm)
  }, [user])

  return (
    <AuthContext.Provider value={{ user, token, login, logout, hasPermission, isAdmin, isOwnScopeUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
