/**
 * Clerk's sign-in, account and organization screens, dressed in the app's own dark field palette
 * (the tokens in globals.css) so they don't look like a separate product. Passed to
 * `<ClerkProvider appearance>` in layout.tsx, so it covers the sign-in modal, the user menu and
 * the organization switcher alike. The "My Application" title and the "Development mode" badge
 * are not styling: the title is the application name in Clerk's dashboard, and the badge goes
 * away on a production instance.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#ff8a3d",
    colorPrimaryForeground: "#0d1210",
    colorBackground: "#121a16",
    colorForeground: "#f4f1e8",
    colorMuted: "#1b2620",
    colorMutedForeground: "#a3ada7",
    colorInput: "#0d1210",
    colorInputForeground: "#f4f1e8",
    colorBorder: "#2a3530",
    colorNeutral: "#f4f1e8",
    colorDanger: "#e5484d",
    colorRing: "#ff8a3d",
    colorModalBackdrop: "rgba(0, 0, 0, 0.7)",
    borderRadius: "0.75rem",
    fontFamily: '"Barlow", ui-sans-serif, system-ui, sans-serif',
    fontFamilyButtons: '"Barlow Condensed", "Barlow", ui-sans-serif, system-ui, sans-serif',
  },
};
