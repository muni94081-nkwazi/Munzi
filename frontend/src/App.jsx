import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import PushNotificationManager from './components/PushNotificationManager';

import SignupPage from './pages/SignupPage';
import LoginPage from './pages/LoginPage';
import ProviderProfileSetupPage from './pages/ProviderProfileSetupPage';
import CustomerProfileSetupPage from './pages/CustomerProfileSetupPage';
import HomePage from './pages/HomePage';
import SearchResultsPage from './pages/SearchResultsPage';
import ProviderDetailPage from './pages/ProviderDetailPage';
import BookingFlowPage from './pages/BookingFlowPage';
import BookingConfirmationPage from './pages/BookingConfirmationPage';
import MyBookingsPage from './pages/MyBookingsPage';
import ProviderDashboardPage from './pages/ProviderDashboardPage';
import ProfilePage from './pages/ProfilePage';
import MessagesPage from './pages/MessagesPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <PushNotificationManager />
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/search" element={<SearchResultsPage />} />
          <Route path="/providers/:id" element={<ProviderDetailPage />} />

          <Route
            path="/provider/setup"
            element={
              <ProtectedRoute role="provider">
                <ProviderProfileSetupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/customer/setup"
            element={
              <ProtectedRoute role="customer">
                <CustomerProfileSetupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/provider/dashboard"
            element={
              <ProtectedRoute role="provider">
                <ProviderDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/book/:serviceId"
            element={
              <ProtectedRoute role="customer">
                <BookingFlowPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/booking/confirmed"
            element={
              <ProtectedRoute role="customer">
                <BookingConfirmationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bookings"
            element={
              <ProtectedRoute>
                <MyBookingsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/messages"
            element={
              <ProtectedRoute>
                <MessagesPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
