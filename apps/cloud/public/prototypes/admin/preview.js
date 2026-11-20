import compact from './compact.js';
import editorial from './editorial.js';
import actionFocused from './action.js';
const variants = [compact, editorial, actionFocused];
const stage = document.getElementById('stage');
const picker = document.querySelector('.proto-picker');
const highlight = picker.querySelector('.proto-picker-highlight');
const items = [...picker.querySelectorAll('.proto-picker-item:not(.proto-picker-replay)')];
const replay = picker.querySelector('.proto-picker-replay');
let current = 0;
function moveHighlight() {
  const el = items[current];
  highlight.style.width = el.offsetWidth + 'px';
  highlight.style.transform = `translateX(${el.offsetLeft}px)`;
}
function mount(i) {
  stage.innerHTML = '';
  requestAnimationFrame(() => { stage.innerHTML = variants[i](); });
}
function setActive(i) {
  if (i < 0 || i >= variants.length) return;
  current = i;
  items.forEach((el, j) => {
    el.toggleAttribute('data-active', j === i);
    if (j === i) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
  moveHighlight();
  const url = new URL(location);
  url.searchParams.set('v', i + 1);
  history.replaceState(null, '', url);
  mount(i);
}
items.forEach((el, i) => el.addEventListener('click', () => setActive(i)));
replay?.addEventListener('click', () => mount(current));
window.addEventListener('resize', moveHighlight);
document.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const num = parseInt(e.key, 10);
  if (num >= 1 && num <= variants.length) setActive(num - 1);
  else if (e.key === 'ArrowRight') setActive((current + 1) % variants.length);
  else if (e.key === 'ArrowLeft') setActive((current - 1 + variants.length) % variants.length);
  else if (e.key === 'r' || e.key === 'R') mount(current);
});
const requested = parseInt(new URLSearchParams(location.search).get('v'), 10);
setActive(requested >= 1 && requested <= variants.length ? requested - 1 : 0);
requestAnimationFrame(() => requestAnimationFrame(() => picker.setAttribute('data-ready', '')));
const users = [
  {name:'Aarav', email:'aarav@example.com',status:'Complete'},
  {name:'Maya', email:'maya@example.com',status:'Complete'},
  {name:'Riya', email:'riya@example.com',status:'Pending'},
  {name:'Kabir', email:'kabir@example.com',status:'Complete'},
];
const search = document.getElementById('user-search');
function renderUsers(pendingOnly=false) {
  const rows = users.filter(user => (!pendingOnly || user.status === 'Pending') && (user.name+' '+user.email).toLowerCase().includes(search.value.toLowerCase()));
  document.getElementById('result-count').textContent = `${rows.length} users${pendingOnly ? ' · pending onboarding' : ''}`;
  const list = document.getElementById('sample-users');
  list.replaceChildren();
  for(const user of rows) {
    const row = document.createElement('div');row.className='sample-user';
    for(const value of [user.name,user.email,user.status]) {const text=document.createElement('span');text.textContent=value;row.append(text);}
    list.append(row);
  }
  if(!rows.length) list.textContent='No matching users. Try another name or email.';
}
search.addEventListener('input',()=>renderUsers());
stage.addEventListener('click',event=>{
  if(event.target.id==='show-pending') {search.value='';renderUsers(true);search.focus();}
});
renderUsers();
