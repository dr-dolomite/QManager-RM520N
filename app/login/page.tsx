import LoginComponent from "@/components/auth/login-component";
import { LoginLanguagePicker } from "@/components/auth/login-language-picker";
import React from "react";

const LoginPage = () => {
  return (
    <div className="bg-background relative flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <LoginLanguagePicker className="fixed top-4 right-4" />
      <div className="w-full max-w-sm">
        <LoginComponent />
      </div>
    </div>
  );
};

export default LoginPage;
