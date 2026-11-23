// Autocompletado como en Bear: [[ sugiere notas y # sugiere etiquetas.
import { autocompletion } from '@codemirror/autocomplete';

export function noteCompletion({ notes, tags }) {
  const source = (ctx) => {
    const wiki = ctx.matchBefore(/\[\[[^\]\n]*$/);
    if (wiki) {
      const after = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2);
      return {
        from: wiki.from + 2,
        options: notes().map((n) => ({
          label: n.name,
          detail: n.title !== n.name ? n.title : n.folder || '',
          type: 'text',
          apply: after === ']]' ? n.name : n.name + ']]',
        })),
        validFor: /^[^\]\n]*$/,
      };
    }
    const tag = ctx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_][\p{L}\p{N}_\-/]*$/u);
    if (tag) {
      const hash = tag.from + tag.text.indexOf('#');
      return {
        from: hash + 1,
        options: tags().map((t) => ({ label: t, type: 'keyword' })),
        validFor: /^[\p{L}\p{N}_\-/]*$/u,
      };
    }
    return null;
  };
  return autocompletion({ override: [source], icons: false, activateOnTyping: true, maxRenderedOptions: 30 });
}
