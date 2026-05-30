import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getMe, logoutApi, setCSRFToken } from '../services/api'

export interface CurrentUser {
  id: number
  username: string
  role: 'admin' | 'user'
  permissions: string[]       // array of permission strings
  view_scope: 'all' | 'own'
  component_access: string[]  // ["kafka","es","zk"]; empty array = all components
}

interface AuthContextValue {
  user: CurrentUser | null
  loading: boolean
  login: (user: CurrentUser, csrfToken: string) => void
  logout: () => Promise<void>
  hasPermission: (perm: string) => boolean
  hasComponent: (component: string) => boolean
  isAdmin: boolean
  isOwnScopeUser: boolean
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: () => {},
  logout: async () => {},
  hasPermission: () => false,
  hasComponent: () => true,
  isAdmin: false,
  isOwnScopeUser: false,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount, restore session from the server (session cookie is sent automatically).
  useEffect(() => {
    getMe()
      .then(res => {
        const d = res.data
        let permissions: string[] = []
        try { permissions = JSON.parse(d.permissions || '[]') } catch { permissions = [] }
        let component_access: string[] = []
        try { component_access = JSON.parse(d.component_access || '[]') } catch { component_access = [] }
        setCSRFToken(d.csrf_token || '')
        setUser({ ...d, permissions, component_access })
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback((u: CurrentUser, csrfToken: string) => {
    setCSRFToken(csrfToken)
    setUser(u)
  }, [])

  const logout = useCallback(async () => {
    try { await logoutApi() } catch { /* ignore */ }
    setCSRFToken('')
    setUser(null)
  }, [])

  const isAdmin = user?.role === 'admin'
  const isOwnScopeUser = !isAdmin && user?.view_scope === 'own'

  const hasPermission = useCallback((perm: string): boolean => {
    if (!user) return false
    if (user.role === 'admin') return true
    return (user.permissions || []).includes(perm)
  }, [user])

  const hasComponent = useCallback((component: string): boolean => {
    if (!user) return false
    if (user.role === 'admin') return true
    const access = user.component_access || []
    if (access.length === 0) return true
    return access.includes(component)
  }, [user])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, hasPermission, hasComponent, isAdmin, isOwnScopeUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

