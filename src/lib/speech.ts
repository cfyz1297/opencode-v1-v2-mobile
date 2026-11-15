import { useState, useCallback, useRef, useEffect } from "react"
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition"
import { shouldSurfaceSpeechError } from "./speech-errors"
import { speechLocale } from "./speech-locale"

interface SpeechState {
  listening: boolean
  transcript: string
  error: string | null
}

interface SpeechActions {
  start: () => Promise<void>
  stop: () => void
  cancel: () => void
}

export function useSpeech(onResult: (text: string) => void): SpeechState & SpeechActions {
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)
  const pending = useRef("")
  const userStarted = useRef(false)

  useSpeechRecognitionEvent("start", () => {
    setListening(true)
    setError(null)
    setTranscript("")
    pending.current = ""
  })

  useSpeechRecognitionEvent("end", () => {
    setListening(false)
    userStarted.current = false
    // Deliver final transcript
    if (pending.current.trim()) {
      onResult(pending.current.trim())
    }
    setTranscript("")
    pending.current = ""
  })

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || ""
    pending.current = text
    setTranscript(text)
  })

  useSpeechRecognitionEvent("error", (event) => {
    const started = userStarted.current
    userStarted.current = false
    setListening(false)
    if (!shouldSurfaceSpeechError({ errorCode: event.error, userStarted: started })) return
    setError(event.message || event.error)
  })

  const start = useCallback(async () => {
    userStarted.current = true
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!result.granted) {
      userStarted.current = false
      setError("Microphone permission denied")
      return
    }
    // BUG-024: use device locale instead of hardcoded en-US; await start() so
    // permission/start errors surface as setError instead of unhandled rejection.
    const locale = speechLocale(Intl.DateTimeFormat().resolvedOptions().locale)
    try {
      await ExpoSpeechRecognitionModule.start({ lang: locale, interimResults: true, continuous: true })
    } catch (err: any) {
      userStarted.current = false
      setError(err?.message || "Failed to start speech recognition")
    }
  }, [])

  const stop = useCallback(() => {
    ExpoSpeechRecognitionModule.stop()
  }, [])

  const cancel = useCallback(() => {
    pending.current = ""
    userStarted.current = false
    ExpoSpeechRecognitionModule.abort()
    setListening(false)
    setTranscript("")
  }, [])

  // Stop the native recognition session when the screen unmounts — otherwise
  // the mic stays hot in the background. abort() is NOT a no-op when idle:
  // Android emits a module-global "aborted" event that every mounted session
  // screen receives, so only abort when this hook actually started listening.
  const listeningRef = useRef(false)
  useEffect(() => {
    listeningRef.current = listening
  }, [listening])
  useEffect(() => {
    return () => {
      userStarted.current = false
      if (listeningRef.current) ExpoSpeechRecognitionModule.abort()
    }
  }, [])

  return { listening, transcript, error, start, stop, cancel }
}
