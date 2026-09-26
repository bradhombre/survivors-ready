import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Lockup } from "@/components/Lockup";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Lockup className="mb-10 text-2xl text-foreground" />
      <h1 className="font-display text-6xl leading-[0.95] text-primary">Blindsided.</h1>
      <p className="mt-3 text-lg text-muted-foreground">That page got voted out.</p>
      <Button asChild variant="accent" className="mt-8">
        <Link to="/">Back to camp</Link>
      </Button>
    </div>
  );
};

export default NotFound;
