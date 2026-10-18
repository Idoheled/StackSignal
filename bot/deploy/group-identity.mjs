export function verifiedGroup(invite, group, identities, normalize) {
  const member = group?.participants?.some(p => [p.id, p.phoneNumber, p.lid].some(id => identities.has(normalize(id))));
  if (invite?.id !== group?.id || invite?.subject !== "StackSignal" || group?.subject !== "StackSignal" || !member ||
      !/^\d{5,30}(?:-\d{5,20})?@g\.us$/.test(group.id)) throw new Error("destination_not_verified");
  return { paired: true, group_verified: true, group_jid: group.id, group_name: group.subject };
}
