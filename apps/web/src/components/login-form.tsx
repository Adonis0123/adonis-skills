"use client";

import * as React from "react";
import { z } from "zod";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ClayButton,
  ClayCard,
  ClayCardContent,
  ClayCardDescription,
  ClayCardHeader,
  ClayCardTitle,
  ClaySurface,
} from "@/components/ui";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export interface LoginFormProps {
  onSubmit?: (values: LoginFormValues) => void | Promise<void>;
}

type FieldErrors = Partial<Record<keyof LoginFormValues, string>>;

export function LoginForm({ onSubmit }: LoginFormProps) {
  const { t } = useLingui();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0] as keyof LoginFormValues;
        if (!fieldErrors[field]) fieldErrors[field] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    try {
      await onSubmit?.(result.data);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ClayCard className="w-full max-w-sm">
      <ClayCardHeader>
        <ClayCardTitle>
          <Trans id="login.title">Sign in</Trans>
        </ClayCardTitle>
        <ClayCardDescription>
          <Trans id="login.description">
            Enter your email and password to continue.
          </Trans>
        </ClayCardDescription>
      </ClayCardHeader>
      <ClayCardContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-email"
              className="font-mono text-xs uppercase tracking-[0.16em] text-clay-muted"
            >
              <Trans id="login.email.label">Email</Trans>
            </label>
            <ClaySurface
              tone="base"
              elevation="inset"
              className="flex h-10 items-center rounded-[1rem] px-4"
            >
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={
                  errors.email ? "login-email-error" : undefined
                }
                placeholder={t({
                  id: "login.email.placeholder",
                  message: "you@example.com",
                })}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-clay-muted"
              />
            </ClaySurface>
            {errors.email ? (
              <p id="login-email-error" className="text-xs text-red-500">
                {errors.email}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="login-password"
              className="font-mono text-xs uppercase tracking-[0.16em] text-clay-muted"
            >
              <Trans id="login.password.label">Password</Trans>
            </label>
            <ClaySurface
              tone="base"
              elevation="inset"
              className="flex h-10 items-center rounded-[1rem] px-4"
            >
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "login-password-error" : undefined
                }
                placeholder={t({
                  id: "login.password.placeholder",
                  message: "••••••••",
                })}
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-clay-muted"
              />
            </ClaySurface>
            {errors.password ? (
              <p id="login-password-error" className="text-xs text-red-500">
                {errors.password}
              </p>
            ) : null}
          </div>

          <ClayButton type="submit" disabled={isSubmitting} className="mt-2">
            {isSubmitting
              ? t({ id: "login.submit.pending", message: "Signing in…" })
              : t({ id: "login.submit", message: "Sign in" })}
          </ClayButton>
        </form>
      </ClayCardContent>
    </ClayCard>
  );
}
