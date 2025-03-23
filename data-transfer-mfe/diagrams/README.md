# Browser-Based Data Transfer System - Architecture Diagrams

This directory contains a set of architectural diagrams documenting the browser-based data transfer system. These diagrams use [Mermaid](https://mermaid-js.github.io/) syntax, which can be rendered in GitHub, VSCode (with plugins), or using the Mermaid Live Editor (https://mermaid.live/).

## Available Diagrams

1. **System Architecture** (1-system-architecture.mmd)
   - Overall sequence diagram showing the interactions between server APIs, browser, and key browser APIs

2. **IndexedDB Schema** (2-indexeddb-schema.mmd)
   - Class diagram detailing the database schema used for persistence

3. **Chunk State Machine** (3-chunk-state-machine.mmd)
   - State diagram for the data chunk lifecycle

4. **Event-Driven Flow** (4-event-driven-flow.mmd)
   - Flowchart showing the event-driven architecture's program flow

5. **Browser APIs Integration** (5-browser-apis-integration.mmd)
   - Detailed sequence diagram showing interactions with browser APIs

6. **IndexedDB Operations** (6-indexeddb-operations.mmd)
   - Sequence diagram showing detailed IndexedDB operations

7. **State Management** (7-state-management.mmd)
   - State diagram for session status with pause/resume logic

8. **Event-Driven Components** (8-event-driven-components.mmd)
   - Class diagram showing the event-driven components

9. **Flow Summary** (9-flow-summary.mmd)
   - High-level graph summary of the data transfer flow

## How to View These Diagrams

1. **In GitHub**: GitHub natively renders Mermaid diagrams when viewing .mmd files
2. **In VSCode**: Install the "Mermaid Preview" extension to view diagrams
3. **Online**: Copy the content and paste it into https://mermaid.live/

## Architecture Highlights

This architecture demonstrates several key aspects of browser-based data transfer:

1. **Event-Driven Design**: The system uses events rather than polling to drive workflow
2. **Browser APIs**: Leverages fetch API for network requests and IndexedDB for persistence
3. **Chunk Processing**: Efficiently processes data in chunks with concurrent operations
4. **Resilience**: Supports pause/resume functionality and handles network errors
5. **State Management**: Clear state transitions for both sessions and data chunks

The browser effectively serves as a powerful intermediary between systems, leveraging its built-in capabilities for network communication and data persistence. 