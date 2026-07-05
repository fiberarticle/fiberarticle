export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Sign-in and sign-up render a full-screen split layout and own their
  // entire viewport; the smaller auth pages bring their own shell.
  return <>{children}</>;
}
