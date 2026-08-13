/**
 * MCP Name Mapper: Maps Star Wars character names from mock sprint data
 * to real team member names from docs/mcp_name_mapping.md.
 */

export interface McpTeamMember {
  personId: string;
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
}

export const STAR_WARS_TO_MCP_MAP: Record<string, { fullName: string; email: string; title?: string }> = {
  'darth vader': { fullName: 'Lucas Baker', email: 'lucas.baker@540.dev' },
  'vader': { fullName: 'Lucas Baker', email: 'lucas.baker@540.dev' },
  'grand admiral thrawn': { fullName: 'Audrey Stewart', email: 'audrey.stewart@540.dev' },
  'thrawn': { fullName: 'Audrey Stewart', email: 'audrey.stewart@540.dev' },
  'general grievous': { fullName: 'Mason Mitchell', email: 'mason.mitchell@540.dev' },
  'grievous': { fullName: 'Mason Mitchell', email: 'mason.mitchell@540.dev' },
  'darth maul': { fullName: 'Ethan Lopez', email: 'ethan.lopez@540.dev' },
  'maul': { fullName: 'Ethan Lopez', email: 'ethan.lopez@540.dev' },
  'darth sidious': { fullName: 'Oliver Taylor', email: 'oliver.taylor@540.dev', title: 'DevSecOps Lead' },
  'sidious': { fullName: 'Oliver Taylor', email: 'oliver.taylor@540.dev', title: 'DevSecOps Lead' },
  'palpatine': { fullName: 'Oliver Taylor', email: 'oliver.taylor@540.dev', title: 'DevSecOps Lead' },
  'grand moff tarkin': { fullName: 'Olivia Baker', email: 'olivia.baker@540.dev' },
  'tarkin': { fullName: 'Olivia Baker', email: 'olivia.baker@540.dev' },
  'director krennic': { fullName: 'Jackson Gray', email: 'jackson.gray@540.dev' },
  'krennic': { fullName: 'Jackson Gray', email: 'jackson.gray@540.dev' },
  'moff jerjerrod': { fullName: 'Gavin Roberts', email: 'gavin.roberts@540.dev' },
  'jerjerrod': { fullName: 'Gavin Roberts', email: 'gavin.roberts@540.dev' },
  'admiral piett': { fullName: 'James Scott', email: 'james.scott@540.dev' },
  'piett': { fullName: 'James Scott', email: 'james.scott@540.dev' },
  'boba fett': { fullName: 'Dylan Williams', email: 'dylan.williams@540.dev' },
  'fett': { fullName: 'Dylan Williams', email: 'dylan.williams@540.dev' },
};

/**
 * Maps a Star Wars character name to a corresponding real team member name.
 * If no mapping match is found, returns the original name intact.
 */
export function mapStarWarsNameToMcpName(name: string): string {
  if (!name) return name;
  const key = name.trim().toLowerCase();
  const exactMatch = STAR_WARS_TO_MCP_MAP[key];
  if (exactMatch) {
    return exactMatch.fullName;
  }
  for (const [swKey, mcpPerson] of Object.entries(STAR_WARS_TO_MCP_MAP)) {
    if (key.includes(swKey) || swKey.includes(key)) {
      return mcpPerson.fullName;
    }
  }
  return name;
}

/**
 * Helper to map action item array owners from Star Wars names to real MCP names.
 */
export function mapActionItemOwners<T extends { owner: string }>(items: T[]): T[] {
  if (!items || !Array.isArray(items)) return items;
  return items.map((item) => ({
    ...item,
    owner: mapStarWarsNameToMcpName(item.owner),
  }));
}
