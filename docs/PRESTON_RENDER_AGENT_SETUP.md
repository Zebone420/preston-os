# Preston Render Agent — Phase 0 Setup

Status: GREEN documentation/setup only. No production deployment, no secrets, no live customer output.

## Goal

Give Claude Code a safe, project-scoped path to drive Blender for dimensionally controlled window/door visualization, with ComfyUI as an optional photoreal refinement layer.

## Recommended stack

1. Blender 4.x (free/open source)
2. BlenderMCP (`MCPBlender/blender-mcp`)
3. Claude Code MCP registration
4. Optional ComfyUI + `Comfy-Org/comfy-mcp` for image refinement/upscaling

## Why this stack

- Blender provides deterministic geometry, camera, materials, lighting, and physically based rendering.
- BlenderMCP exposes scene/object/material/render controls to Claude over MCP.
- ComfyUI can be added later for img2img, ControlNet-style geometry preservation, refinement, and upscaling.
- Keep the first gate Blender-only. Add ComfyUI only after Blender rendering passes validation.

## Safety posture

BlenderMCP can execute Python inside Blender. Treat that capability as YELLOW/RED-adjacent and constrain usage to an isolated render workstation/worktree until explicitly promoted.

Rules:

- Do not put API keys in this repository.
- Do not enable Sketchfab/Hyper3D/Hunyuan credentials during Phase 0.
- Do not write outside approved render input/output directories.
- Do not alter Preston production services, database, Vercel, Supabase, n8n, or customer systems.
- Generated renderings are conceptual unless explicitly verified against approved drawings/specifications.
- No customer-facing send is permitted without owner approval.

## Windows workstation prerequisites

Run in PowerShell on the designated rendering workstation.

### 1. Install Blender

Install Blender 4.x from the official Blender distribution and launch it once.

### 2. Install uv

```powershell
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Restart PowerShell, then verify:

```powershell
uv --version
uvx --version
```

### 3. Install the Blender MCP addon

```powershell
uvx blender-mcp install-addon
```

In Blender:

1. Edit > Preferences > Add-ons
2. Search for `Blender MCP`
3. Enable `Interface: Blender MCP`
4. In the 3D viewport press `N`
5. Open the BlenderMCP tab
6. Start the MCP server

The default local bridge is expected on `127.0.0.1:9876`.

### 4. Register Blender with Claude Code

From `C:\dev\preston-os`:

```powershell
claude mcp add blender uvx blender-mcp
```

Verify:

```powershell
claude mcp list
```

Do not register external API credentials in this gate.

## Phase 0 acceptance test

Open Blender with a blank scene and ask Claude Code to perform only the following benign test:

1. Inspect the current scene.
2. Add a wall plane or rectangular wall volume.
3. Add one simple framed window opening/object.
4. Add a camera and two lights.
5. Assign neutral materials.
6. Render a PNG into an approved local render-output folder.
7. Report all Blender objects created and the output path.

PASS requires:

- Claude can read the Blender scene.
- Claude can create/edit objects.
- Claude can render successfully.
- No secrets are requested or exposed.
- No network-backed asset service is required.
- No Preston production system is touched.

## Preston architectural rendering rules (initial)

Future Render Agent prompts should enforce:

- Preserve supplied masonry/facade geometry unless a change is explicitly requested.
- Use verified window/door dimensions from the supplied schedule/drawing only.
- Preserve unit count, operation, handing, grille lite count, frame color, brickmould/panning dimensions, and sill/threshold condition.
- Do not invent structural changes.
- Distinguish `CONCEPTUAL RENDER` from `APPROVAL/CONSTRUCTION DOCUMENT`.
- Maintain a render manifest containing source files, verified dimensions, material assumptions, render engine/settings, camera view, and unresolved assumptions.

## Optional Phase 1: ComfyUI

Only after Blender-only acceptance passes.

ComfyUI and `Comfy-Org/comfy-mcp` can be installed on a GPU workstation and registered with Claude Code. Prefer local models first to avoid per-image API cost. Partner API nodes remain optional and must use secrets outside the repository.

Example registration pattern (path must be adapted to the workstation):

```powershell
claude mcp add comfy-mcp -e COMFY_BIN="C:\path\to\comfy.exe" -- comfy-mcp
```

Do not commit `COMFY_API_KEY` or any model-provider credential.

## Target architecture

```text
Preston request / approved project data
          |
          v
     Claude Code
          |
          +---- MCP ----> BlenderMCP ----> Blender ----> geometry/render pass
          |
          +---- MCP ----> ComfyUI (optional) ----> photoreal refinement/upscale
          |
          v
 Render manifest + generated assets
          |
          v
 Owner review / approval
```

## Next gate

After workstation installation and the benign Blender acceptance test pass, create a Preston-specific Render Agent schema and render manifest format. Do not connect the renderer to unattended orchestration until owner approval.