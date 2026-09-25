import React, { useState, FormEvent, ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

const Login: React.FC = () => {
  const [isLogin, setIsLogin] = useState<boolean>(true);
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [adminAuthCode, setAdminAuthCode] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setMessage("");

    if (!username.trim()) {
      setMessage("Username is required");
      return;
    }

    if (!password) {
      setMessage("Password is required");
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    if (!isLogin && password.length < 6) {
      setMessage("Password must be at least 6 characters");
      return;
    }

    if (!isLogin && !adminAuthCode.trim()) {
      setMessage("Admin auth code is required");
      return;
    }

    setIsSubmitting(true);

    try {
      let result;
      if (isLogin) {
        result = await login(username, password);
      } else {
        result = await register(username, password, adminAuthCode);
      }

      setMessage(result.message);

      if (result.success) {
        setUsername("");
        setPassword("");
        setConfirmPassword("");
        setAdminAuthCode("");
        navigate("/payments");
      }
    } catch (error) {
      setMessage("An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMode = (): void => {
    setIsLogin(!isLogin);
    setMessage("");
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setAdminAuthCode("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-black via-gray-900 to-black flex items-center justify-center px-4">
      <div className="w-full max-w-md anim-in">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-red-500/20 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-r from-red-600 to-red-700 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path>
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-white mb-2">
              {isLogin ? "Welcome Back" : "Create Account"}
            </h2>
            <p className="text-gray-400">
              {isLogin ? "Sign in to manage your finance tracker" : "Register to start tracking finances"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-red-400 font-medium mb-2">
                USERNAME
              </label>
              <input
                type="text"
                value={username}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setUsername(e.target.value)}
                className="w-full bg-black/50 border-2 border-red-500/50 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 focus:bg-black/70 focus:scale-[1.02] transition-all duration-300 placeholder-gray-400"
                placeholder="Enter your username"
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label className="block text-red-400 font-medium mb-2">
                PASSWORD
              </label>
              <input
                type="password"
                value={password}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className="w-full bg-black/50 border-2 border-red-500/50 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 focus:bg-black/70 focus:scale-[1.02] transition-all duration-300 placeholder-gray-400"
                placeholder="Enter your password"
                disabled={isSubmitting}
              />
            </div>

            {!isLogin && (
              <div>
                <label className="block text-red-400 font-medium mb-2">
                  CONFIRM PASSWORD
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
                  className="w-full bg-black/50 border-2 border-red-500/50 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 focus:bg-black/70 focus:scale-[1.02] transition-all duration-300 placeholder-gray-400"
                  placeholder="Confirm your password"
                  disabled={isSubmitting}
                />
              </div>
            )}

            {!isLogin && (
              <div>
                <label className="block text-red-400 font-medium mb-2">
                  ADMIN AUTH CODE
                </label>
                <input
                  type="password"
                  value={adminAuthCode}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setAdminAuthCode(e.target.value)}
                  className="w-full bg-black/50 border-2 border-red-500/50 text-white px-4 py-3 rounded-lg focus:outline-none focus:border-red-500 focus:bg-black/70 focus:scale-[1.02] transition-all duration-300 placeholder-gray-400"
                  placeholder="Enter admin authorization code"
                  disabled={isSubmitting}
                />
              </div>
            )}

            {message && (
              <div
                className={`p-3 rounded-lg text-white font-medium text-sm ${
                  message.includes("success") ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {message}
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full py-3 px-6 rounded-lg font-bold text-lg transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] ${
                  isSubmitting
                    ? "bg-gray-600 cursor-not-allowed text-gray-300"
                    : "bg-gradient-to-r from-red-600 to-red-700 text-white hover:from-red-700 hover:to-red-800 shadow-lg hover:shadow-red-500/25 border border-red-500"
                }`}
              >
                {isSubmitting ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Please wait...
                  </span>
                ) : (
                  isLogin ? "Sign In" : "Create Account"
                )}
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={toggleMode}
              className="text-red-400 hover:text-red-300 font-medium transition-all duration-300 hover:scale-105 active:scale-95"
              disabled={isSubmitting}
            >
              {isLogin ? (
                <span>
                  Don't have an account? <span className="text-white font-bold">Register</span>
                </span>
              ) : (
                <span>
                  Already have an account? <span className="text-white font-bold">Sign In</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;