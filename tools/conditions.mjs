/* <!--if:KEY-->…<!--/if:KEY--> blocks: text that is only there while a sign-in
 * method is offered (tools/build.mjs decides which are, from AUTH_PROVIDERS).
 *
 * Two ways to write one, and a Markdown page needs both:
 *
 *   inside a line      Δεν λαμβάνουμε τον κωδικό σας σε {{signin-social}}.<!--if:social--> …<!--/if:social-->
 *   on lines of their  <!--if:google-->
 *   own                - **Google:** …
 *                      <!--/if:google-->
 *
 * With the markers alone on their lines, a block that is switched off takes its
 * whole lines with it, and one that stays leaves no blank line behind, so the
 * list around it stays one tight list. Done on the text, before it is Markdown. */

/** s with every block resolved; test(key) says whether the block is kept (and throws for a key it does not know). */
export function applyConditions(s, file, test) {
  const keep = (k, inner) => (test(k, file) ? applyConditions(inner, file, test) : '');
  const out = s
    .replace(/^[ \t]*<!--if:([a-z]+)-->[ \t]*\r?\n([\s\S]*?)^[ \t]*<!--\/if:\1-->[ \t]*(?:\r?\n|$)/gm, (m, k, inner) => keep(k, inner))
    .replace(/<!--if:([a-z]+)-->([\s\S]*?)<!--\/if:\1-->/g, (m, k, inner) => keep(k, inner));
  const left = /<!--\/?if:[a-z]*-->/.exec(out);
  if (left) throw new Error(`${file}: ${left[0]} has no partner (every <!--if:KEY--> needs its <!--/if:KEY-->)`);
  return out;
}
