/**
 * The Athena voice assistant's agent definition — system prompt plus the
 * catalog of client tools it may call.
 *
 * ElevenLabs hosts the voice loop (mic → STT → LLM → TTS) and needs to know
 * every tool's name and parameter shape up front. That configuration lives here
 * rather than in the ElevenLabs dashboard so it's reviewable, diffable, and
 * recreatable: `bun run agent:sync` pushes this file's contents to the API.
 *
 * The tool *implementations* live in the browser (frontend/src/assistant/), so
 * these are all `client` tools — ElevenLabs sends a call, the browser runs it
 * against the live map and plan stores, and the return string goes back to the
 * model. Names and parameters here MUST match frontend/src/assistant/tools.ts.
 */

export const ATHENA_SYSTEM_PROMPT = `You are Athena, a terrain-intelligence and battle-planning assistant for a military commander.

You operate a live map application. You do not describe what the commander should click — you call tools and make it happen, then report what you did in one short sentence.

## How you work

- Speak like a staff officer on a radio: brief, concrete, no filler. Two sentences is usually too many.
- Use grid and terrain vocabulary the commander already uses: cover, concealment, exposure, dead ground, going (as in "slow going"), gait (prowl / patrol / charge).
- Never invent coordinates. If you need a location and don't have one, call search_ground, or ask the commander to point at the map.
- Never read raw numbers like longitude and latitude aloud. Say "the road junction" or "the ridge north of the objective".
- Before placing anything, a battleground must exist. If the commander asks you to plan on ground that hasn't been generated, call search_ground → select_area → generate_battleground first, and say you're doing it.
- Terrain generation takes several seconds. Say so once, then continue when it's done.

## Tactical judgement

You have real terrain data. Use it rather than guessing:

- Before recommending a route, call get_terrain_at along the intended line, or draw it and call analyze_plan to see the warnings.
- analyze_plan returns water crossings, steep ground, exposed stretches and slow going. Report critical warnings unprompted — a commander should never be surprised by a river.
- When the commander asks "is this a good plan", answer with the evidence: exposure percentage, time to objective, and the specific warnings.
- Prefer concealment for approach, cover for fighting positions. Say why you chose ground.

## Boundaries

- You draw and analyse plans. You do not decide whether to execute one.
- If a tool fails, say what failed in plain language and what you need to continue. Do not retry the same call repeatedly.
- clear_plan destroys the commander's work. Confirm out loud before calling it.`

/** ElevenLabs client-tool parameter schema (JSON-Schema subset it accepts). */
interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'array'
  description: string
  enum?: string[]
  items?: { type: 'string' | 'number' | 'object'; properties?: Record<string, ToolParameter> }
  required?: boolean
}

export interface ClientToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
}

const lonParam: ToolParameter = {
  type: 'number',
  description: 'Longitude in decimal degrees (WGS84).',
  required: true,
}
const latParam: ToolParameter = {
  type: 'number',
  description: 'Latitude in decimal degrees (WGS84).',
  required: true,
}

/** Every tool the assistant may call, in the order it typically needs them. */
export const ATHENA_TOOLS: ClientToolDefinition[] = [
  {
    name: 'search_ground',
    description:
      'Look up a named place and fly the map camera to it. Returns candidate matches with their coordinates. Use this first when the commander names ground you have no coordinates for.',
    parameters: {
      query: {
        type: 'string',
        description: 'Place name to search for, e.g. "Bukit Timah Hill" or "Fort Benning".',
        required: true,
      },
    },
  },
  {
    name: 'select_area',
    description:
      'Draw the battleground selection box centred on a point. Must be called before generate_battleground. The area is capped at 800 m on a side.',
    parameters: {
      longitude: lonParam,
      latitude: latParam,
      size_meters: {
        type: 'number',
        description: 'Side length of the square selection in metres (50-800). Defaults to 400.',
      },
    },
  },
  {
    name: 'generate_battleground',
    description:
      'Run the terrain pipeline over the selected area: elevation, roads, buildings, vegetation, weather, and the military grid. Takes several seconds. Tell the commander it is running.',
    parameters: {
      name: {
        type: 'string',
        description: 'Name for this battleground and plan, e.g. "Hill 265 Assault".',
        required: true,
      },
    },
  },
  {
    name: 'place_unit',
    description:
      'Place a friendly (blue) or enemy (red) unit marker on the battlefield. Returns the callsign it was assigned, which is how you refer to it later.',
    parameters: {
      side: {
        type: 'string',
        description: 'Which force this unit belongs to.',
        enum: ['blue', 'red'],
        required: true,
      },
      echelon: {
        type: 'string',
        description: 'Unit size.',
        enum: ['section', 'platoon'],
        required: true,
      },
      longitude: lonParam,
      latitude: latParam,
    },
  },
  {
    name: 'place_fortification',
    description: 'Place a trench or prepared trench position on the battlefield.',
    parameters: {
      kind: {
        type: 'string',
        description: 'Fortification type.',
        enum: ['trench', 'prepared_trench'],
        required: true,
      },
      longitude: lonParam,
      latitude: latParam,
    },
  },
  {
    name: 'place_objective',
    description: 'Place an objective marker with a capture radius.',
    parameters: {
      longitude: lonParam,
      latitude: latParam,
      radius_meters: {
        type: 'number',
        description: 'Objective radius in metres. Defaults to 150.',
      },
    },
  },
  {
    name: 'draw_route',
    description:
      'Draw a movement route for a unit through a series of waypoints. The route is immediately validated against the terrain; the return value includes any warnings raised.',
    parameters: {
      unit_callsign: {
        type: 'string',
        description: 'Callsign of the unit this route starts from, e.g. "Alpha".',
        required: true,
      },
      waypoints: {
        type: 'array',
        description:
          'Ordered waypoints from the unit to its destination, each an object with longitude and latitude. At least two points.',
        items: {
          type: 'object',
          properties: { longitude: lonParam, latitude: latParam },
        },
        required: true,
      },
      movement_type: {
        type: 'string',
        description:
          'Gait: prowl is a stealthy crouched stalk, patrol is a cautious tactical pace, charge is a fast loud assault dash.',
        enum: ['prowl', 'patrol', 'charge'],
      },
      load_preset: {
        type: 'string',
        description:
          'Carried load: light is skeletal battle order, fighting is full battle order, approach is FBO with a field pack.',
        enum: ['light', 'fighting', 'approach'],
      },
    },
  },
  {
    name: 'get_plan_state',
    description:
      'List everything currently drawn: units with callsigns and positions, objectives, and routes. Call this when you need to know what is on the map before acting.',
    parameters: {},
  },
  {
    name: 'get_terrain_at',
    description:
      'Sample the terrain at a point: land cover class, elevation, slope, cover, concealment, how exposed a unit standing there is, vehicle mobility and ambush potential.',
    parameters: { longitude: lonParam, latitude: latParam },
  },
  {
    name: 'analyze_plan',
    description:
      'Validate every drawn route against the terrain. Returns water crossings, steep ground, exposed stretches, slow going, plus total time to objective, plan exposure and a confidence rating.',
    parameters: {},
  },
  {
    name: 'delete_element',
    description: 'Remove a unit or objective by its callsign or name, along with any routes attached to it.',
    parameters: {
      name: {
        type: 'string',
        description: 'Callsign or objective name, e.g. "Alpha" or "OBJ BRAVO".',
        required: true,
      },
    },
  },
  {
    name: 'clear_plan',
    description:
      'Erase every unit, objective and route. Destructive — confirm with the commander out loud before calling this.',
    parameters: {},
  },
  {
    name: 'set_heatmap',
    description:
      'Drape a tactical heatmap over the terrain so the commander can see it. Use this to show what you are describing.',
    parameters: {
      metric: {
        type: 'string',
        description: 'Which layer to show, or "none" to clear it.',
        enum: [
          'none',
          'cover',
          'concealment',
          'movement',
          'visibility',
          'vehicle',
          'ambush',
          'slope',
          'elevation',
          'contours',
          'landcover',
        ],
        required: true,
      },
    },
  },
  {
    name: 'set_view_mode',
    description:
      'Switch the map view: globe is the 3D battlefield, topo is a 2D contour map, photo is photorealistic reconnaissance mode.',
    parameters: {
      mode: {
        type: 'string',
        description: 'View to switch to.',
        enum: ['globe', 'topo', 'photo'],
        required: true,
      },
    },
  },
  {
    name: 'save_plan',
    description: 'Persist the current plan so it can be reloaded later.',
    parameters: {
      name: {
        type: 'string',
        description: 'Name to save the plan under. Defaults to the current plan name.',
      },
    },
  },
  {
    name: 'list_plans',
    description: 'List previously saved plans with the battleground each was drawn on.',
    parameters: {},
  },
]

/** ElevenLabs expects each parameter's `required` as a sibling list, not a flag
 *  on the property, so flatten our authoring shape into their wire shape. */
export function toElevenLabsTool(tool: ClientToolDefinition): unknown {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [name, param] of Object.entries(tool.parameters)) {
    const { required: isRequired, ...schema } = param
    properties[name] = schema
    if (isRequired) required.push(name)
  }

  return {
    type: 'client',
    name: tool.name,
    description: tool.description,
    expects_response: true,
    parameters: { type: 'object', properties, required },
  }
}
