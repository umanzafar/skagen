import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import LoginPage from './pages/LoginPage';
import EmployeePage from './pages/EmployeePage';
import ManagerDashboard from './pages/ManagerDashboard';

const ProtectedRoute = ({ children, requiredRole }) => {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!user) return <Navigate to="/login" replace />;
  if (requiredRole && user.role !== requiredRole) return <Navigate to="/login" replace />;
  return children;
};

function App() {
  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/employee" element={
          <ProtectedRoute requiredRole="employee">
            <EmployeePage />
          </ProtectedRoute>
        } />
        <Route path="/manager" element={
          <ProtectedRoute requiredRole="manager">
            <ManagerDashboard />
          </ProtectedRoute>
        } />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

export default App;