import { Link } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-16 sm:py-24 text-center">
        <div className="mb-6">
          <span className="text-6xl font-bold text-muted-foreground/20">404</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link to="/">
          <Button size="lg">Back to Home</Button>
        </Link>
      </div>
    </Layout>
  );
}
