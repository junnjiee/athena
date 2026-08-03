import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ConversationProvider, useConversation } from '@elevenlabs/react'
import { AlertCircle, Loader2, Mic, MicOff, Radio, X } from 'lucide-react'
import { assistantTools } from '../../assistant/tools'

/**
 * Voice assistant dock.
 *
 * ElevenLabs hosts the voice loop; this owns the session lifecycle and exposes
 * `assistantTools` as client tools the agent calls against the live map. The API
 * key never reaches the browser — `/api/assistant/session` mints a short-lived
 * WebRTC conversation token server-side.
 */

interface TranscriptEntry {
  id: number
  role: 'commander' | 'athena'
  text: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'unconfigured'; message: string }
  | { kind: 'error'; message: string }

const MAX_TRANSCRIPT = 40

/** Client tools are plain functions returning a string the agent speaks back.
 *  Wrapped so a thrown error becomes a sentence rather than killing the turn. */
const clientTools = Object.fromEntries(
  Object.entries(assistantTools).map(([name, handler]) => [
    name,
    async (args: Record<string, unknown> = {}) => {
      try {
        return await handler(args)
      } catch (error: unknown) {
        return error instanceof Error
          ? `That failed: ${error.message}`
          : 'That failed for an unknown reason.'
      }
    },
  ]),
)

/**
 * The assistant is an accessory to the map, never a reason to lose it. Any
 * throw from the SDK or a tool is caught here so the battlefield keeps
 * rendering with a small inline notice instead of a blank screen.
 */
class AssistantErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="glass-deep pointer-events-auto flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-(--text-dim)">
          <AlertCircle className="h-3.5 w-3.5 text-(--hostile)" strokeWidth={1.75} />
          Assistant unavailable
        </div>
      )
    }
    return this.props.children
  }
}

function DockBody() {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const entryId = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const addEntry = useCallback((role: TranscriptEntry['role'], text: string) => {
    setTranscript((prev) => [...prev, { id: entryId.current++, role, text }].slice(-MAX_TRANSCRIPT))
  }, [])

  const conversation = useConversation({
    onConnect: () => setPhase({ kind: 'idle' }),
    onMessage: ({ message, source }) => {
      addEntry(source === 'user' ? 'commander' : 'athena', message)
    },
    onError: (message: string) => setPhase({ kind: 'error', message }),
  })

  const { status, isSpeaking, isMuted, setMuted, startSession, endSession } = conversation
  const live = status === 'connected'

  // Pin the transcript to the newest line.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [transcript])

  // Leaving the page mid-conversation should hang up, not leave a live mic.
  const endSessionRef = useRef(endSession)
  useEffect(() => {
    endSessionRef.current = endSession
  }, [endSession])
  useEffect(() => {
    return () => endSessionRef.current()
  }, [])

  const start = useCallback(async () => {
    setPhase({ kind: 'connecting' })
    setTranscript([])

    let conversationToken: string
    try {
      const res = await fetch('/api/assistant/session')
      const body = (await res.json()) as { conversationToken?: string; error?: string }
      if (res.status === 503) {
        setPhase({ kind: 'unconfigured', message: body.error ?? 'Assistant is not configured.' })
        return
      }
      if (!res.ok || !body.conversationToken) {
        setPhase({ kind: 'error', message: body.error ?? `Session request failed (${res.status}).` })
        return
      }
      conversationToken = body.conversationToken
    } catch {
      setPhase({ kind: 'error', message: 'Could not reach the Athena service.' })
      return
    }

    // Prompt for the mic before handing off, so a denial reads as a permission
    // problem rather than an opaque SDK connection error.
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setPhase({
        kind: 'error',
        message: 'Microphone access denied. Allow it in your browser to use voice.',
      })
      return
    }

    try {
      startSession({ conversationToken, connectionType: 'webrtc' })
    } catch (error: unknown) {
      setPhase({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not start the voice session.',
      })
    }
  }, [startSession])

  const stop = useCallback(() => {
    endSession()
    setPhase({ kind: 'idle' })
  }, [endSession])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Athena voice assistant"
        className="glass-deep pointer-events-auto flex h-11 w-11 items-center justify-center rounded-xl text-(--text) transition-colors hover:text-(--text-h)"
      >
        <Mic className="h-4 w-4" strokeWidth={1.75} />
      </button>
    )
  }

  const connecting = phase.kind === 'connecting' || status === 'connecting'

  return (
    <div className="glass-deep pointer-events-auto flex w-80 flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Radio
            className={`h-4 w-4 ${isSpeaking ? 'animate-pulse text-(--accent)' : live ? 'text-(--accent)' : 'text-(--text-dim)'}`}
            strokeWidth={1.75}
          />
          <span className="text-sm text-(--text-h)">Athena</span>
          <span className="text-xs text-(--text-dim)">
            {connecting ? 'connecting…' : isSpeaking ? 'speaking' : live ? 'listening' : 'off air'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={() => setMuted(!isMuted)}
              title={isMuted ? 'Unmute your microphone' : 'Mute your microphone'}
              className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
            >
              {isMuted ? (
                <MicOff className="h-4 w-4 text-(--hostile)" strokeWidth={1.75} />
              ) : (
                <Mic className="h-4 w-4" strokeWidth={1.75} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              stop()
              setOpen(false)
            }}
            title="Close"
            className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {(phase.kind === 'unconfigured' || phase.kind === 'error') && (
        <div className="flex items-start gap-2 rounded-lg bg-black/20 p-2.5 text-xs text-(--text)">
          <AlertCircle
            className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${phase.kind === 'error' ? 'text-(--hostile)' : 'text-(--text-dim)'}`}
            strokeWidth={1.75}
          />
          <span>{phase.message}</span>
        </div>
      )}

      {transcript.length > 0 && (
        <div ref={scrollRef} className="flex max-h-56 flex-col gap-2 overflow-y-auto">
          {transcript.map((entry) => (
            <div key={entry.id} className="text-xs leading-relaxed">
              <span className={entry.role === 'athena' ? 'text-(--accent)' : 'text-(--text-dim)'}>
                {entry.role === 'athena' ? 'ATHENA' : 'YOU'}
              </span>{' '}
              <span className="text-(--text)">{entry.text}</span>
            </div>
          ))}
        </div>
      )}

      {!live && transcript.length === 0 && phase.kind === 'idle' && (
        <p className="text-xs leading-relaxed text-(--text-dim)">
          Ask Athena to find ground, generate a battlefield, place units, draw routes, or analyse
          the plan.
        </p>
      )}

      <button
        type="button"
        disabled={connecting}
        onClick={() => (live ? stop() : void start())}
        className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
          live
            ? 'glass text-(--text) hover:text-(--text-h)'
            : 'bg-(--accent) text-(--panel-bg-solid) hover:bg-(--accent-hover) disabled:bg-white/10 disabled:text-(--text-dim)'
        }`}
      >
        {connecting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
            Connecting
          </>
        ) : live ? (
          'End session'
        ) : (
          <>
            <Mic className="h-4 w-4" strokeWidth={2} />
            Start talking
          </>
        )}
      </button>
    </div>
  )
}

export function AssistantDock() {
  return (
    <AssistantErrorBoundary>
      <ConversationProvider clientTools={clientTools}>
        <DockBody />
      </ConversationProvider>
    </AssistantErrorBoundary>
  )
}
