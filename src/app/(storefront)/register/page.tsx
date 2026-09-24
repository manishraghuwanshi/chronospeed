import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { RegisterForm } from "@/components/auth/register-form";
import { Container } from "@/components/ui/container";
import { getCurrentCustomer } from "@/lib/auth/session";

/**
 * Create-account page.
 *
 * Mirrors `/login`: a Server Component that redirects an already authenticated
 * customer away, with the form itself in a Client Component. Registration signs the
 * customer in on success, so there is no separate "now sign in" step.
 */

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Chronospeed account.",
  robots: { index: false, follow: false },
};

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const customer = await getCurrentCustomer();

  if (customer) {
    redirect("/account");
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;

  return (
    <Container className="flex flex-1 items-start justify-center py-14 sm:py-20">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col gap-3">
          <p className="text-xs tracking-[0.3em] text-accent uppercase">Account</p>
          <h1 className="text-3xl font-semibold tracking-tight">Create your account</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            One account keeps your details, orders and saved watches together. It takes a moment.
          </p>
        </div>

        <RegisterForm next={next} />
      </div>
    </Container>
  );
}