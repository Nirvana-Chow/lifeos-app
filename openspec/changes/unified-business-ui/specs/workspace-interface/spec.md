# Spec Delta

## Purpose

Provide a consistent Chinese-first business interface that preserves the user's existing records, actions and access boundaries across desktop and mobile. Appearance controls and record tables must remain usable without weakening authoritative save and recovery behavior.

## ADDED Requirements

### Requirement: Shared business visual language
The system SHALL use consistent typography, semantic colors, spacing, controls and navigation hierarchy across existing business pages while retaining available actions and accurate service states.

#### Scenario: Move between business modules
- **WHEN** the owner visits home, tasks, projects, areas, journal, data, settings or another registered business module
- **THEN** the pages retain their available inputs, details and actions within the shared visual language
- **AND** missing integrations remain explicit instead of displaying invented records, totals or success

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

### Requirement: Header appearance control
The system SHALL expose directly operable light, dark and system choices in both business Headers, including an identifiable selected state for keyboard and touch users.

#### Scenario: Change appearance while using tasks
- **WHEN** the owner selects a Header appearance choice on the tasks page
- **THEN** the page, table and open dialogs immediately use the selected appearance without opening settings
- **AND** another appearance control in the same document displays the same choice

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
