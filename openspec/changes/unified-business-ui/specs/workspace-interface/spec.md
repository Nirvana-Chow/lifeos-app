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
The system SHALL retain visible focus, readable Chinese text and reachable dialog actions in both themes at desktop and 360/390/430px widths. Body and form text SHALL be at least 16px, metadata at least 14px and interactive targets at least 44px.

#### Scenario: Edit on a narrow display
- **WHEN** the owner opens and edits a task at a mobile width
- **THEN** labels, inputs, errors, cancel and save remain reachable without document-wide horizontal overflow
- **AND** focus stays visible and returns appropriately after the dialog closes

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
