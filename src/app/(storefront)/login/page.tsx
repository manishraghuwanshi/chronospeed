import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { Container } from "@/components/ui/container";
import { getCurrentCustomer } from "@/lib/auth/session";

/**
 * Sign-in page.
 *
 * A Server Component: it resolves the existing session (to bounce an already
 * signed-in customer straight to their account) and `redirect()`s with the path they
 * were trying to reach. The interactive part is the `SignInForm` Client Component.
 *
 * `searchParams` is a Promise in Next 16 — synchronous access was removed — and the
 * `next` value is passed through to the form unchanged. The action is what validates
 * it into a same-origin path, so an untrusted value never decides where the browser
 * goes on its own.
 */

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Chronospeed account.",
  robots: { index: false, follow: false },
};

export default async function SignInPage({ searchParams }: PageProps<"/login">) {
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
          <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Your account will hold your orders, addresses and wishlist as those parts of the store are
            built.
          </p>
        </div>

        <SignInForm next={next} />
      </div>
    </Container>
  );
}