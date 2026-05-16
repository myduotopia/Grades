import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './layout/AppShell'
import { AdminSemesters } from './pages/AdminSemesters'
import { AdminSubjects } from './pages/AdminSubjects'
import { AuthCallback } from './pages/AuthCallback'
import { Classes } from './pages/Classes'
import { Grades } from './pages/Grades'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Students } from './pages/Students'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<Home />} />
              <Route path="/classes" element={<Classes />} />
              <Route
                path="/classes/:classroomId/students"
                element={<Students />}
              />
              <Route
                path="/classes/:classroomId/grades"
                element={<Grades />}
              />
              <Route path="/admin/subjects" element={<AdminSubjects />} />
              <Route path="/admin/semesters" element={<AdminSemesters />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
