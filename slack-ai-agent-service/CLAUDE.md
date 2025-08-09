# Claude Code Instructions

## Task Master AI Instructions
**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md


### MANDATORY: TaskMaster Integration Requirements
**Use BOTH tools appropriately:**
- **TodoWrite**: For internal reasoning and short-term progress tracking within sessions
- **TaskMaster**: For all project communication, logging, and persistent tracking

1. **ALWAYS use Context7 MCP first** - Before any implementation, research the latest documentation and best practices using Context7 MCP to ensure you're following current standards.

2. **Start every session with TaskMaster:**
   ```
   task-master next                    # Get next available task
   task-master show <id>              # Review task details
   ```

3. **For each subtask, follow the mandatory iterative cycle:**
   ```
   task-master show <subtask-id>                                    # Understand requirements
   task-master update-subtask --id=<id> --prompt="PLAN: [detailed implementation plan]"   # Log plan
   task-master set-status --id=<id> --status=in-progress          # Mark as started
   [Use TodoWrite for internal step-by-step progress tracking]
   [IMPLEMENT CODE]
   task-master update-subtask --id=<id> --prompt="PROGRESS: [what worked/didn't work]" # Log progress
   task-master update-subtask --id=<id> --prompt="COMPLETED: [final summary]" # Log completion
   task-master set-status --id=<id> --status=done                 # Mark complete
   ```

4. **Create todo_${seq}.md file for overall planning only** - TodoWrite + TaskMaster handle detailed tracking

5. **Before you begin working, check in with me and I will verify the plan.**

6. **Give high-level explanations at each step** - detailed progress goes in TaskMaster subtasks

7. **Simplicity principle:** Every change should impact minimal code. Small functions with unit tests.

8. **Final review section** in the todo_${seq}.md file with summary of changes.

## Context7 MCP Integration
- Context7 MCP is configured in .mcp.json and provides access to the latest documentation
- Use it for checking current best practices, security recommendations, and implementation patterns
- Always consult latest documentation before implementing new features or making architectural decisions
