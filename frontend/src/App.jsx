import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './hooks/useAuth';

// Lazy-loaded pages
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Customers    = lazy(() => import('./pages/Customers'));
const Samples      = lazy(() => import('./pages/Samples'));
const Products     = lazy(() => import('./pages/Products'));
const Yarn         = lazy(() => import('./pages/Yarn'));
const Planning     = lazy(() => import('./pages/Planning'));
const Machines     = lazy(() => import('./pages/Machines'));
const Manufacturing = lazy(() => import('./pages/Manufacturing'));
const Employees    = lazy(() => import('./pages/Employees'));
const Quality      = lazy(() => import('./pages/Quality'));
const Shipping     = lazy(() => import('./pages/Shipping'));
const Login        = lazy(() => import('./pages/Login'));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin" />
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <PageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index                   element={<Dashboard />} />
          <Route path="customers"        element={<Customers />} />
          <Route path="samples"          element={<Samples />} />
          <Route path="products"         element={<Products />} />
          <Route path="yarn"             element={<Yarn />} />
          <Route path="planning"         element={<Planning />} />
          <Route path="machines"         element={<Machines />} />
          <Route path="manufacturing"    element={<Manufacturing />} />
          <Route path="employees"        element={<Employees />} />
          <Route path="quality"          element={<Quality />} />
          <Route path="shipping"         element={<Shipping />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
