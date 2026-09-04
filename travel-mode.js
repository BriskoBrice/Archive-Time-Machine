(() => {
  'use strict';
  const travel = document.getElementById('travelModeBtn');
  const launch = document.getElementById('openCapsuleBtn');
  if (!travel || !launch) return;
  travel.addEventListener('click', () => launch.click());
})();
