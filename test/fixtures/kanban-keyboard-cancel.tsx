"use client"

import { useEffect, useState } from "react"
import {
  Kanban, KanbanBoard, KanbanColumn, KanbanColumnContent, KanbanItem, KanbanItemHandle,
} from "../../src/ui-review/reui/kanban"

function Board({ restoreFocus }: { restoreFocus: boolean }) {
  const [value, setValue] = useState({ left: ["card"], right: [] as string[] })
  const [commits, setCommits] = useState(0)

  return (
    <section data-testid={restoreFocus ? "default-focus" : "no-focus-restore"}>
      <button type="button">Before board</button>
      <Kanban<string>
        value={value}
        onValueChange={next => setValue({ left: next.left, right: next.right })}
        onValueCommit={() => setCommits(count => count + 1)}
        getItemValue={item => item}
        {...(restoreFocus ? {} : { restoreOnCancel: true, accessibility: { restoreFocus: false } })}
      >
        <KanbanBoard style={{ display: "flex", gap: 16 }}>
          {Object.entries(value).map(([column, items]) => (
            <KanbanColumn key={column} value={column} style={{ width: 160, minHeight: 100 }}>
              <KanbanColumnContent value={column}>
                {items.map(item => (
                  <KanbanItem key={item} value={item}>
                    <KanbanItemHandle asChild>
                      <button type="button" aria-label="Drag synthetic card">Drag</button>
                    </KanbanItemHandle>
                  </KanbanItem>
                ))}
              </KanbanColumnContent>
            </KanbanColumn>
          ))}
        </KanbanBoard>
      </Kanban>
      <button type="button">After board</button>
      <output data-testid="counts">{commits} commits</output>
    </section>
  )
}

export default function KanbanKeyboardFixture() {
  const [escapeEvents, setEscapeEvents] = useState<number | null>(null)

  useEffect(() => {
    setEscapeEvents(0)
    const recordEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEscapeEvents(count => (count ?? 0) + 1)
    }
    document.addEventListener("keydown", recordEscape)
    return () => document.removeEventListener("keydown", recordEscape)
  }, [])

  return (
    <>
      <Board restoreFocus />
      <Board restoreFocus={false} />
      <output data-testid="escaped-events">{escapeEvents === null ? "Loading" : `${escapeEvents} Escape events`}</output>
    </>
  )
}
