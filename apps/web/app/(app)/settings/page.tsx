import { redirect } from "next/navigation";

// Settings now opens as a centered modal (components/settings-dialog.tsx)
// over whatever page the user is on. Old /settings links land on the
// dashboard with the modal open.
export default function SettingsPage() {
  redirect("/dashboard?settings=preferences");
}
