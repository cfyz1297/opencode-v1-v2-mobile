// expo-modules-core unregisters an activity-result launcher when the Activity is
// destroyed and only re-registers it at module creation, which runs once per
// process (AppContextActivityResultRegistry: ON_DESTROY -> unregister). Once
// Android recreates the Activity under a live process, every expo picker call
// throws this and only a restart (fresh AppContext) brings the launcher back —
// so retrying, including `legacy: true`, cannot help.
export function isDeadLauncherError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "")
  return /unregistered ActivityResultLauncher/i.test(message)
}
