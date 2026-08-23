import { Link } from "react-router";
import { motion } from "framer-motion";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export default function AuthPage() {
  const { login, isAuthenticated, user, logout } = useAuth();

  if (isAuthenticated && user) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 sm:py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="mb-6">
              {user.avatar ? (
                <img src={user.avatar} alt={user.name} className="h-16 w-16 rounded-full mx-auto object-cover ring-4 ring-border" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-accent/10 flex items-center justify-center mx-auto text-2xl font-bold text-accent">
                  {user.name[0]}
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold mb-2">Welcome back, {user.name.split(" ")[0]}</h1>
            <p className="text-muted-foreground mb-8">You&apos;re signed in to Velnox.</p>
            <div className="flex flex-col gap-3">
              <Link to="/products">
                <Button className="w-full" size="lg">Browse Products</Button>
              </Link>
              <Button variant="outline" className="w-full" size="lg" onClick={logout}>
                Sign out
              </Button>
            </div>
          </motion.div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <div className="mb-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-xl mx-auto">
              V
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">
            Welcome to Velnox
          </h1>
          <p className="text-muted-foreground mb-8">
            Sign in to shop, save favorites, and manage your orders.
          </p>

          <div className="space-y-4">
            <Button
              size="lg"
              className="w-full text-base h-12"
              onClick={login}
            >
              <svg className="mr-3 h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            By continuing, you agree to Velnox&apos;s{" "}
            <span className="underline cursor-pointer">Terms of Service</span>{" "}
            and{" "}
            <span className="underline cursor-pointer">Privacy Policy</span>.
          </p>
        </motion.div>
      </div>
    </Layout>
  );
}
