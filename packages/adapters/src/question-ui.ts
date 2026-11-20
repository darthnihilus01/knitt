import { basename } from 'node:path';
import { relativeActivity } from './conversation.ts';
import type { ClientName } from './hooks.ts';

export type QuestionChoice = { choiceId: string; client?: ClientName; title: string; modified: string; summary?: string; titleSource?: string };
export function questionPageSize(client: ClientName) {
  // Claude supports at most four options; reserve one for navigation. Codex's
  // synchronous question tool supports three. Antigravity supports full lists.
  return client === 'antigravity' ? 50 : client === 'claude' ? 3 : 2;
}
const clean = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
export function nativeQuestion(client: ClientName, workspace: string, choices: QuestionChoice[], page: number, pages: number, prompt?: string, controls: {label:string;choiceId:string}[] = []) {
  const question = prompt ?? 'Which previous conversation would you like to continue in ' + basename(workspace) + '? Project: ' + workspace;
  const choiceMap: Record<string, string> = {};
  const labels = choices.map((choice, index) => {
    const source = choice.client ? { codex: 'Codex', claude: 'Claude', antigravity: 'Antigravity' }[choice.client] : '';
    const prefix = String(index + 1) + (source ? '. [' + source + '] ' : '. ');
    const title = clean(choice.title) || 'Untitled chat';
    const activity = choice.modified ? relativeActivity(choice.modified) : '';
    const detail = [choice.summary, activity, choice.titleSource === 'fallback' ? 'Fallback title' : ''].filter(Boolean).join(' · ');
    const label = client === 'claude' ? (prefix + title).slice(0, 32) : prefix + title.slice(0, 80) + (detail ? ' — ' + detail : '');
    choiceMap[label] = choice.choiceId;
    return { label, description: clean(detail + ' · ' + title).slice(0, 300) };
  });
  for(const control of controls) choiceMap[control.label]=control.choiceId;
  const navigation = pages > 1 ? { label: page + 1 < pages ? 'More chats' : 'Newest chats', page: (page + 1) % pages } : undefined;
  const cancelLabel = labels.length === 1 && !navigation && !controls.length ? 'Cancel' : undefined;
  const strings = [...labels.map(choice => choice.label), ...controls.map(c=>c.label), ...(navigation ? [navigation.label] : []), ...(cancelLabel ? [cancelLabel] : [])];
  let tool: string;
  let args: Record<string, unknown>;
  if (client === 'antigravity') {
    tool = 'ask_question';
    args = { questions: [{ question, options: strings, is_multi_select: false }], toolAction: 'Selecting a previous conversation', toolSummary: 'Choose a project conversation' };
  } else if (client === 'claude') {
    tool = 'AskUserQuestion';
    args = { questions: [{ question, header: 'Pick chat', multiSelect: false, options: [...labels, ...controls.map(c=>({label:c.label,description:'Change conversation source'})), ...(navigation ? [{ label: navigation.label, description: 'Show another page of this project’s chats' }] : []), ...(cancelLabel ? [{ label: cancelLabel, description: 'Stop without selecting a conversation' }] : [])] }] };
  } else {
    tool = 'request_user_input_async';
    args = { questions: [{ title: question, options: strings }] };
  }
  return { tool, arguments: args, choiceMap, ...(navigation ? { navigation } : {}), ...(cancelLabel ? { cancelLabel } : {}) };
}
