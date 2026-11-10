# Spec Delta

## Purpose

Provide a consistent Chinese-first business interface that preserves the user's existing records, actions and access boundaries across desktop and mobile. Appearance controls and record tables must remain usable without weakening authoritative save and recovery behavior.

## ADDED Requirements

### Requirement: Shared business visual language
The system SHALL use consistent typography, semantic colors, spacing, controls and navigation hierarchy across existing business pages while retaining available actions and accurate service states.

#### Scenario: Move between business modules
- **WHEN** the owner visits home, tasks, projects, areas, journal, data, settings or another registered business module
- **THEN** the pages retain their available inputs, details and actions within the shared visual language
- **AND** an unavailable module uses a concise state in the shared shell when reached directly

### Requirement: Reachable private business navigation
The system SHALL resolve registered business destinations exactly behind the existing owner/MFA gate and SHALL preserve canonical journal editing and unsaved-navigation protection without expanding API or edge access.

#### Scenario: Follow a business link
- **WHEN** the owner follows a journal or another registered business link
- **THEN** the journal opens its canonical editor and other destinations show their available or honest unavailable state
- **AND** refresh preserves the destination, unknown or extra segments return 404, and synthetic query parameters do not activate data clients
- **AND** dirty, saving and uncertain editor navigation protections remain effective

#### Scenario: A visitor lacks an authorized owner session
- **WHEN** an anonymous, non-owner, expired or non-MFA-ready session requests a registered private page
- **THEN** the existing access gate denies private content and retains private no-store behavior

### Requirement: Keep owner pages focused on their purpose

The system SHALL group domain and project actions with Todo, limit Journal to journal records and editing, and keep account and security controls in Settings. Primary navigation SHALL hide unfinished business entries and links to generic internal record management.

#### Scenario: Navigate between tasks, journal and settings

- **WHEN** the owner navigates between Overview, Todo, Journal and Settings
- **THEN** the primary workspace uses consistent branding and navigation and the journal bookmark retains the same appearance preference
- **AND** journal pages contain journal records and their actions, while Todo contains domain and project actions
- **AND** settings content is centered and adapts to the available width

#### Scenario: Edit a single field or expanded detail

- **WHEN** the owner double-clicks a writable card/list/Overview title or activates Enter/F2
- **THEN** only its title enters field editing through the authoritative save adapter
- **AND** expanding the task opens directly editable details without another edit-mode action, while readonly access retains static detail
- **AND** table fields retain native editing and resizable columns without an extra persistence writer
- **AND** completion/reopen actions use the same status writer in list, table and board
- **AND** existing revision, receipt, dirty-draft and unknown-outcome safeguards apply

#### Scenario: Scroll and navigate within the workspace

- **WHEN** the owner scrolls long content, uses account pages or changes workspace destination
- **THEN** Header, sidebar and bottom sidebar actions remain reachable without an extra document-height footer row
- **AND** a separately installed filing footer overlays only the content area with enough reserved scroll padding
- **AND** password and API-key management retain the shared shell and return to Settings
- **AND** canonical URLs support refresh and guarded back/forward without losing an unconfirmed draft

#### Scenario: Understand the Overview

- **WHEN** the complete workspace snapshot is available
- **THEN** Overview shows pending, due-today and overdue counts with links to their full views
- **AND** any shortened task preview identifies its limit and offers the full task view
- **AND** the project preview and count include only projects whose stage is active
- **AND** partial or unknown coverage does not claim complete totals

### Requirement: Header appearance control
The system SHALL expose one keyboard-operable and touch-accessible icon button in the shared Header that switches between light and dark. It SHALL reflect the effective appearance and identify its next action. The initial preference SHALL follow the operating system.

#### Scenario: Change appearance while using tasks
- **WHEN** the owner activates the Header appearance button on the tasks page
- **THEN** the page, table and open dialogs immediately use the opposite appearance without opening settings
- **AND** another appearance control in the same document reflects the same effective appearance

### Requirement: Consistent appearance lifecycle
The system SHALL preserve a valid appearance preference across refresh and routes, follow operating-system changes only in system mode, synchronize cross-window changes and remain usable when storage is unavailable.

#### Scenario: Refresh an explicit preference
- **WHEN** the owner selects dark appearance, refreshes and opens another business page
- **THEN** the first visible appearance and Header choice remain dark without an opposite-theme flash

#### Scenario: Follow the operating system
- **WHEN** system appearance is selected and the operating-system appearance changes without settings mounted
- **THEN** the current business or standalone form follows the change
- **AND** an explicit light or dark choice continues to override operating-system changes

#### Scenario: Preference storage is denied
- **WHEN** the browser rejects preference storage
- **THEN** the selected mode still applies in the current document and the control reports that persistence was unavailable

### Requirement: Responsive and accessible interaction
The system SHALL preserve readable Chinese text, visible focus and reachable actions in both themes. Mobile/touch layouts SHALL retain16px body/input,14px metadata and44px targets. The owner's compact fine-pointer desktop preference SHALL be applied independently, without global CSS zoom or disabling browser zoom.

#### Scenario: Edit on a narrow display
- **WHEN** the owner opens and edits a task at a mobile width
- **THEN** labels, inputs, errors, cancel and save remain reachable without document-wide horizontal overflow
- **AND** focus stays visible and returns appropriately after the dialog closes

#### Scenario: Use a compact desktop workbench
- **WHEN** the owner opens the workspace at1366×768 or1440×900 with100% browser zoom
- **THEN** the default desktop density shows more readable rows without changing mobile sizes
- **AND** at widths >=1024px with a fine pointer, body14px, metadata12px and controls32px implement the explicit desktop correction to the earlier all-width16/14/44 rule
- **AND** narrow native scrollbars retain mouse, keyboard and touchpad operation
- **AND** three curated palette families each provide complete light/dark semantic states, with first-paint and preference synchronization preserved

### Requirement: Owner-review requirements and matter usability
The system SHALL continue the existing shared workspace with a concise phase roadmap, persistent owner requirement intake/editing, leading task completion, native column preferences and authoritative Kanban status movement. Public baseline evidence and owner acceptance SHALL remain distinct from privately edited planning content.

#### Scenario: Inspect and edit one requirements pool
- **WHEN** an authorized owner adds text or changes a requirement's content, priority, real dates or phase
- **THEN** the same visible pool preserves public stable IDs and private original/history, performs versioned save/readback and retains uncertain commands
- **AND** the compact table/board groups by phase, colors retain labels, and Gantt uses genuine dates while keeping undated items visible
- **AND** detail expansion occupies the content region and retains sidebar, draft/navigation guards and focus restoration

#### Scenario: Create and move a matter
- **WHEN** the owner creates a todo or moves a board card
- **THEN** project/domain choices are visible and optional, topic controls are absent from new-todo UI and existing topic links survive other edits
- **AND** completion precedes title, reordered/hidden columns keep stable field identities, and status changes use the original writer/CAS/receipt/readback
- **AND** keyboard/mobile move alternatives and cancel/conflict/unknown recovery remain available
- **AND** browser-only layout preferences are not represented as shared record ranking

### Requirement: Preserve record correctness and privacy
The system MUST retain owner/MFA and write permissions, source and record IDs, revisions, command semantics, draft recovery, authoritative receipts and unknown/conflict handling during interface changes.

#### Scenario: Save is uncertain or conflicts
- **WHEN** a task edit produces an unknown outcome or a stale revision
- **THEN** the existing recovery or conflict flow remains available without discarding input or reporting unconfirmed success
- **AND** a retry retains the original command and revision boundaries

#### Scenario: A table cell is remounted
- **WHEN** a virtualized editable cell is unmounted and remounted for the same record, field and revision
- **THEN** its retained draft remains recoverable without another business writer or an optimistic saved state

### Requirement: Equivalent table validation
The system SHALL validate the selected table against the fixed previous-renderer baseline using equivalent synthetic records, fields, edit/save guards, themes and desktop/mobile interaction. Correctness and measured performance evidence SHALL identify matching conditions and limitations.

#### Scenario: Compare the selected renderer
- **WHEN** table adoption is evaluated
- **THEN** editing, Chinese input, keyboard/focus, sorting/filtering, draft recovery, unknown/conflict and persisted readback use equivalent conditions
- **AND** local-array demonstrations or vendor claims do not count as business persistence or measured performance acceptance

### Requirement: One table foundation
The system SHALL use one selected table foundation for current editable and read-only consumers, preserving stable row identity, filtering, sorting, charts, cards, editing links and truthful loading/error/empty states. The previous renderer SHALL remain only a fixed comparison baseline without current runtime or type dependencies.

#### Scenario: Open a read-only projection
- **WHEN** a current project or action projection renders a table
- **THEN** it retains the source IDs, records, filtering and sorting without acquiring a save writer
- **AND** related charts, cards, editing links and access boundaries remain available

#### Scenario: Inspect the application dependency boundary
- **WHEN** the current application source and dependency lock are checked
- **THEN** the removed renderer and its editors are neither imported nor installed as runtime, type-only or transitive dependencies


### Requirement: Visible development requirements
The system SHALL expose a canonical owner-gated requirements destination using the existing generic baseline, with stable identifiers, development goals, ordered milestones, priority, implementation state, acceptance state, blockers, next actions and traceable public references.

#### Scenario: Inspect the next development step
- **WHEN** the owner opens the requirements page and filters its rows
- **THEN** milestone order, remaining work and acceptance criteria are visible from the same baseline
- **AND** source completion, automated evidence, deployment and owner acceptance remain distinct, with no invented calendar dates or personal data
- **AND** the informational page does not expose task creation and anonymous access remains denied

### Requirement: Browse categories before creating them
The system SHALL group Todo, Projects and Areas in the task workspace and provide shared sortable, resizable ReUI category tables with explicit search/filter and separate view-tasks, edit and create actions.

#### Scenario: Open a saved project or domain
- **WHEN** the owner opens Projects or Areas
- **THEN** saved category rows are shown before a creation form and row actions retain stable identities
- **AND** partial snapshots do not claim full task counts, changed references remain visible and edits use the existing revision-aware editor

### Requirement: Lightweight topic settings
The system SHALL make saved business topics reachable from Settings in a dialog which dismisses on outside click or Escape and restores focus.

#### Scenario: Browse or edit a topic
- **WHEN** the owner opens topic settings
- **THEN** only verified saved topic titles and revisions are listed, with explicit permitted create/edit links
- **AND** unknown or failed snapshots remain explicit and navigation preserves active draft guards

### Requirement: Understand API-key expiry
The system SHALL use equal-height API-key form controls and a usable native custom date input and SHALL distinguish estimated expiry in an explicit timezone from the authoritative issued expiry.

#### Scenario: Choose a key duration
- **WHEN** the owner chooses an allowed duration or a custom date
- **THEN** the form shows its duration and estimated expiry, accepts no more than 365 days and preserves the existing scope and one-time-reveal lifecycle

### Requirement: Keep input features and Agent capabilities aligned
Each newly supported input feature SHALL ship its implemented scoped Agent operation, capability discovery and Skill reference together without advertising unsupported operations or silently widening existing grants.

#### Scenario: A business input feature is not yet supported by Agent API
- **WHEN** its implementation or grant is unavailable
- **THEN** the roadmap marks the missing capability and existing todo credentials remain described by their actual scopes

### Requirement: Settings preserve the workspace
The system SHALL open the entire Settings interface as a controlled modal over the current workspace, preserving its page, filters, scroll and drafts, and SHALL provide protected compatible direct entrances with finite history state.

#### Scenario: Open settings while working
- **WHEN** the owner opens and dismisses Settings or traverses its browser history
- **THEN** the original workspace stays mounted and is restored without discarding drafts or unconfirmed requests
- **AND** new key creation and one-time reveal/copy/close occur in a nested controlled dialog with no key in history or persistent browser storage

### Requirement: Compact multidimensional roadmap
The system SHALL provide table, board and Gantt projections of one full-personal-data requirements baseline and SHALL open long criteria and evidence in an expandable detail dialog.

#### Scenario: Inspect requirements without planning dates
- **WHEN** the owner switches the same filtered requirements to Gantt
- **THEN** every undated item remains available in 未排期 and opens the same detail
- **AND** the system does not invent intervals from stage order or a todo deadline

### Requirement: Bounded workspace scrolling
The system SHALL keep workspace toolbars and table or board headings reachable while the bounded content area scrolls.

#### Scenario: Browse a long board
- **WHEN** a board column contains more cards than fit in the viewport
- **THEN** its cards scroll within the content region while the workspace toolbar and column heading stay visible

### Requirement: Portable Agent Skill
The system SHALL provide a credential-free downloadable Skill and copyable installation instructions with implemented operations and own-credential requirements.

#### Scenario: Share the integration
- **WHEN** a user downloads or copies the Skill instructions
- **THEN** they receive reviewed generic instructions without any account key or private record
- **AND** discovery and the Skill describe the same actual scoped operations

### Requirement: Training volume and coverage
The health workspace SHALL display training volume and direct muscle coverage from an explicitly opened, versioned Xunji analytics snapshot. The selected file SHALL be processed in memory in the browser. The feature SHALL preserve the existing training calendar and record operations.

#### Scenario: Compare periods and muscle groups
- **WHEN** the owner opens a valid snapshot and chooses a day, week, month, quarter or year grain
- **THEN** the interface groups completed work sets into the selected natural calendar periods and shows both total and selected muscle volume
- **AND** the interface shows tracked direct muscle coverage, separately labeled known kilograms and pounds, and the source period and completeness

#### Scenario: Distinguish incomplete history
- **WHEN** a source date is missing or marked partial, a completed set has no safe external load, or an exercise has no muscle mapping
- **THEN** the interface exposes the relevant gap and never imputes a zero, a unit, or a muscle attribution
- **AND** it only reports zero completed work for a verified complete period with no matching work

### Requirement: Cooking workspace

The signed-in workspace SHALL offer category and ingredient-based selection from a pinned Chinese recipe catalog and show the selected recipe's ingredient and preparation information, steps and source. Unknown recipe values SHALL remain unknown.

#### Scenario: Decide what to cook

- **WHEN** the owner opens the cooking workspace and enters ingredients or chooses a category
- **THEN** it presents a small set of matching suggestions, an action to see different matches where available and access to the entire filtered catalog
- **AND** the owner can open a recipe and read its ingredients and instructions on a narrow display

#### Scenario: Revisit a completed meal

- **WHEN** the owner saves a completed cooking record with an optional photo
- **THEN** the date, linked recipe, notes and any attached photo can be reread by the same owner after refresh
- **AND** the site does not claim that unavailable or failed persistence succeeded
- **AND** the record and attachment are inaccessible to other accounts, with scoped API capability and Skill available for implemented record operations

### Requirement: Owner storage review workspace
The personal workspace SHALL serve the storage review interface only to the existing authenticated owner. The interface SHALL preview a selected versioned CSV or JSON checklist, preserve stable item identifiers and persist explicitly saved review data within the owner's LifeOS space.

#### Scenario: Review a selected checklist
- **WHEN** the owner opens a valid checklist and chooses keep, trash review, or defer for an editable item
- **THEN** the interface records a choice for that checklist revision and exports it in a versioned JSON file with the item identifier
- **AND** processed and protected items remain read-only in the browser and in the server writer
- **AND** a deletion candidate is a review decision with no filesystem effect

#### Scenario: Save and resume review in another browser
- **WHEN** the owner explicitly saves a checklist and selects a decision on its saved version
- **THEN** the owner can open the same checklist and independently reread the decision in another authenticated browser
- **AND** an unsaved import remains a local preview, and an outdated request cannot replace a newer checklist or decision
- **AND** generic Inbox and machine routes exclude private review rows unless a reviewed scoped operation explicitly grants access

#### Scenario: Protect access
- **WHEN** the route receives a request without a verified owner principal
- **THEN** it redirects to sign-in without sending the review interface
- **AND** the route responses use private no-store caching
