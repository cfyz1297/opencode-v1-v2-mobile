import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSurfaceSpeechError } from './speech-errors.ts'

test('speech errors stay silent until the user starts listening', () => {
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'not-allowed', userStarted: false }), false)
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'audio-capture', userStarted: false }), false)
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'not-allowed', userStarted: true }), true)
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'no-speech', userStarted: true }), false)
})

test('aborted is benign even for the screen that started listening', () => {
  // abort() is the documented result of cleanup, and the native event is
  // module-global: a second screen's unmount used to surface "Voice input
  // failed" over a microphone that was still listening.
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'aborted', userStarted: true }), false)
  assert.equal(shouldSurfaceSpeechError({ errorCode: 'aborted', userStarted: false }), false)
})
