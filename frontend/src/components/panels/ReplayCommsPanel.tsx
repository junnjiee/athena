import { useEffect, useRef } from 'react'
import { Radio } from 'lucide-react'
import type { ReplayLog } from '../../types/replayLog'

interface Props {
  replay: ReplayLog
  currentStep: number
}

/** Resolves a message's sender to its communication group's name/team --
 *  senders are only known by soldier_index, groups only carry member indices. */
function groupFor(replay: ReplayLog, senderIndex: number, groupId: string) {
  return replay.battlefield.communication_groups.find(
    (g) => g.group_id === groupId && g.member_indices.includes(senderIndex),
  )
}

/** Bottom-left comms log during replay playback -- mirrors TerrainInfoPanel's
 *  glass card convention. Shows every message up to and including the current
 *  step, auto-scrolling to the newest as playback advances. */
export function ReplayCommsPanel({ replay, currentStep }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const entries = replay.steps.slice(0, currentStep + 1).flatMap((step) =>
    step.messages.map((message) => ({
      step: step.step,
      message,
      group: groupFor(replay, message.sender_index, message.group_id),
    })),
  )

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries.length])

  return (
    <div className="glass flex w-72 flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span>COMMS</span>
        <Radio className="h-3 w-3" />
      </div>
      {entries.length === 0 ? (
        <div className="py-2 text-xs text-(--text-dim)">No traffic yet</div>
      ) : (
        <div ref={scrollRef} className="flex max-h-40 flex-col gap-2 overflow-y-auto">
          {entries.map(({ step, message, group }, i) => (
            <div key={`${step}-${i}`} className="text-xs">
              <div
                className={`mb-0.5 ${group?.team === 'red' ? 'text-(--hostile)' : 'text-(--friendly)'}`}
              >
                {group?.name ?? message.group_id}
                <span className="ml-1.5 text-(--text-dim)">· step {step}</span>
              </div>
              <div className="text-(--text)">{message.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
