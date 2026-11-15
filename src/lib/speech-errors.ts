/** Whether a native speech-recognition error should surface to the user. */
export function shouldSurfaceSpeechError(options: {
  errorCode?: string
  userStarted: boolean
}): boolean {
  if (options.errorCode === 'no-speech') return false
  // 'aborted' is the documented result of abort(), and these events are
  // module-global: another screen's unmount cleanup aborts the recogniser and
  // this screen received the "Voice input failed" alert for voice it never
  // started. Benign regardless of who started it.
  if (options.errorCode === 'aborted') return false
  // Emulators often emit permission/module errors when the recognition
  // package loads, even if the user never tapped the mic.
  return options.userStarted
}
