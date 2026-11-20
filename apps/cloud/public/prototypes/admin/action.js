export default function actionFocused() {
  return `<section class="action-summary" aria-label="Account overview"><div><span class="eyebrow">NEEDS ATTENTION</span><h2>One user hasn’t finished onboarding</h2><p class="subtle">They’ve signed in but haven’t chosen a username.</p><button id="show-pending" class="primary" type="button">View pending user</button></div><dl><div><dt>Total users</dt><dd>4</dd></div><div><dt>New this week</dt><dd>2</dd></div><div><dt>Installations</dt><dd>5</dd></div></dl></section>`;
}
