import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { AppShell } from './layout/AppShell'
import { SemesterViewProvider } from './state/SemesterView'
import { AdminItems } from './pages/AdminItems'
import { AdminReasons } from './pages/AdminReasons'
import { AdminSemesters } from './pages/AdminSemesters'
import { AdminSubjects } from './pages/AdminSubjects'
import { AuthCallback } from './pages/AuthCallback'
import { Classes } from './pages/Classes'
import { ClassroomPoints } from './pages/ClassroomPoints'
import { GradeEntry } from './pages/GradeEntry'
import { Grades } from './pages/Grades'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Points } from './pages/Points'
import { Settings } from './pages/Settings'
import { StudentDetail } from './pages/StudentDetail'
import { Students } from './pages/Students'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route element={<ProtectedRoute />}>
            <Route
              element={
                <SemesterViewProvider>
                  <AppShell />
                </SemesterViewProvider>
              }
            >
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
              <Route
                path="/classes/:classroomId/grades/entry"
                element={<GradeEntry />}
              />
              <Route path="/students/:studentId" element={<StudentDetail />} />
              <Route path="/admin/subjects" element={<AdminSubjects />} />
              <Route path="/admin/semesters" element={<AdminSemesters />} />
              <Route path="/admin/items" element={<AdminItems />} />
              <Route path="/admin/reasons" element={<AdminReasons />} />
              <Route path="/points" element={<Points />} />
              <Route
                path="/points/:classroomId"
                element={<ClassroomPoints />}
              />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
