/**
 * Declarative schema-driven GUI builder for Toyheart mini-apps.
 * Supports grouped collapsible sections (`param.group`), range sliders, toggles,
 * dropdowns, and pigment color scales.
 */
export function renderParamControls({
  container,
  params = [],
  values = {},
  onChange,
  pigmentScale = null,
  pigmentHexes = [],
  onPigmentChange = null,
}) {
  container.innerHTML = '';
  const groups = new Map();

  for (const param of params) {
    const groupName = param.group || '__default__';
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(param);
  }

  const pigmentContainer = document.createElement('div');
  pigmentContainer.className = 'pigment-container';

  function buildControlRow(param) {
    const isToggle = param.type === 'toggle';
    const isSelect = param.type === 'select';
    const initialVal = values[param.key];

    const row = document.createElement('label');
    row.className = isToggle ? 'param-row param-toggle-row' : 'param-row';

    if (isToggle) {
      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'param-toggle';
      input.checked = Boolean(initialVal);

      input.addEventListener('change', () => {
        const val = input.checked ? 1 : 0;
        values[param.key] = val;
        onChange?.(param.key, val);
      });

      row.append(nameSpan, input);
    } else if (isSelect) {
      const header = document.createElement('div');
      header.className = 'param-header';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;
      header.appendChild(nameSpan);

      const select = document.createElement('select');
      for (const optDef of param.options) {
        const opt = document.createElement('option');
        opt.value = String(optDef.value);
        opt.textContent = optDef.label;
        if (optDef.value === initialVal) opt.selected = true;
        select.appendChild(opt);
      }

      select.addEventListener('change', () => {
        const val = isNaN(Number(select.value)) ? select.value : parseFloat(select.value);
        values[param.key] = val;
        onChange?.(param.key, val);
      });

      row.append(header, select);
    } else {
      const header = document.createElement('div');
      header.className = 'param-header';

      const nameSpan = document.createElement('span');
      nameSpan.textContent = param.label;

      const valSpan = document.createElement('span');
      valSpan.className = 'param-val';
      valSpan.textContent =
        param.step >= 1 ? String(initialVal) : Number(initialVal).toFixed(2);

      header.append(nameSpan, valSpan);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = param.min;
      input.max = param.max;
      input.step = param.step;
      input.value = initialVal;

      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        values[param.key] = val;
        valSpan.textContent = param.step >= 1 ? String(val) : val.toFixed(2);
        onChange?.(param.key, val);

        if (pigmentScale && param.key === pigmentScale.countParam) {
          renderPigmentPickers(pigmentContainer, pigmentScale, values, pigmentHexes, onPigmentChange);
        }
      });

      row.append(header, input);
    }

    return row;
  }

  for (const [groupName, groupParams] of groups.entries()) {
    if (groupName === '__default__') {
      for (const p of groupParams) {
        container.appendChild(buildControlRow(p));
      }
    } else {
      const details = document.createElement('details');
      details.className = 'param-group-details';
      details.open = true;

      const summary = document.createElement('summary');
      summary.textContent = groupName;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'param-group-body';
      for (const p of groupParams) {
        body.appendChild(buildControlRow(p));
      }
      details.appendChild(body);
      container.appendChild(details);
    }
  }

  if (pigmentScale) {
    container.appendChild(pigmentContainer);
    renderPigmentPickers(pigmentContainer, pigmentScale, values, pigmentHexes, onPigmentChange);
  }
}

export function renderPigmentPickers(container, scale, values, pigmentHexes, onPigmentChange) {
  container.innerHTML = '';
  if (!scale) return;

  const count = Math.round(values[scale.countParam] ?? 1);
  const title = document.createElement('div');
  title.className = 'pigment-title';
  title.textContent = `Brush Pigments (${count})`;
  container.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'pigment-grid';

  for (let i = 0; i < count; i++) {
    const def = scale.defaults[i] || { label: `Brush ${i + 1}`, hex: '#333333' };
    if (!pigmentHexes[i]) pigmentHexes[i] = def.hex;

    const item = document.createElement('label');
    item.className = 'pigment-item';
    item.title = def.label;

    const swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.value = pigmentHexes[i];
    onPigmentChange?.(i, swatch.value, scale.toUniform(swatch.value));

    swatch.addEventListener('input', () => {
      pigmentHexes[i] = swatch.value;
      onPigmentChange?.(i, swatch.value, scale.toUniform(swatch.value));
    });

    const num = document.createElement('span');
    num.textContent = `${i + 1}`;

    item.append(swatch, num);
    grid.appendChild(item);
  }

  container.appendChild(grid);
}
