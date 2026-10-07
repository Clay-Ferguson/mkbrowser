import type { ComponentType, SVGProps } from 'react';
import { CubeIcon, EnvelopeIcon, MapPinIcon, LinkIcon, PhoneIcon, CalendarIcon } from '@heroicons/react/24/outline';
import type { PropertyType } from '../../shared/shared';
import type { GenericObjectData, ObjectRow } from '../../shared/objects/genericObject';
import { api } from '../../renderer/api';
import { buildEmailUrl, buildMapUrl, buildPhoneUrl, buildWebUrl } from '../../shared/objects/objectUrls';
import { BUTTON_CLASS_LINK_BLUE } from '../../renderer/styles';

/** Row icon per property type; plain text rows have none. Dates are shown, not linked. */
const TYPE_ICONS: Partial<Record<PropertyType, ComponentType<SVGProps<SVGSVGElement>>>> = {
  email: EnvelopeIcon,
  address: MapPinIcon,
  url: LinkIcon,
  phone: PhoneIcon,
  date: CalendarIcon,
};

/** Hover text for the click action of a linked value, where it isn't opening the browser. */
const LINK_ACTIONS: Partial<Record<PropertyType, string>> = {
  email: 'send email',
  phone: 'call',
};

/** The URL a value of this property type opens when clicked, or undefined for plain text. */
function hrefFor(propertyType: PropertyType, value: string): string | undefined {
  switch (propertyType) {
    case 'email': return buildEmailUrl(value);
    case 'address': return buildMapUrl(value);
    case 'url': return buildWebUrl(value);
    case 'phone': return buildPhoneUrl(value);
    default: return undefined;
  }
}

// pre-line keeps the line breaks of a multi-line (YAML `|`) value. No colour here: plain values
// add their own, and links take the link colour.
const VALUE_CLASS = 'min-w-0 break-words whitespace-pre-line';
const PLAIN_VALUE_CLASS = `${VALUE_CLASS} text-slate-300`;
const LABEL_CLASS = 'whitespace-nowrap text-slate-400';

/**
 * One defined property: type icon, property name, value. An address or url value is a link that
 * opens in the system browser; an email value is a `mailto:` link and a dialable phone value a
 * `tel:` link, both handed to the system's handler for them. Everything else is plain text.
 */
function PropertyRow({ row }: { row: ObjectRow }) {
  const Icon = TYPE_ICONS[row.propertyType];
  const href = hrefFor(row.propertyType, row.value);
  const tooltip = row.description || row.key;
  return (
    <>
      <span className="flex h-5 items-center">
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </span>
      <span className={LABEL_CLASS} title={tooltip}>{row.key}</span>
      {href ? (
        // A click on the card opens the editor on mouseup, so the link stops mouseup as well
        // as click from reaching the entry's content area.
        <button
          type="button"
          className={`${VALUE_CLASS} ${BUTTON_CLASS_LINK_BLUE} text-left`}
          title={`${tooltip}: ${LINK_ACTIONS[row.propertyType] ?? 'open in browser'}`}
          onClick={(e) => {
            e.stopPropagation();
            void api.openExternalUrl(href);
          }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {row.value}
        </button>
      ) : (
        <span className={PLAIN_VALUE_CLASS} title={tooltip}>{row.value}</span>
      )}
    </>
  );
}

/**
 * Card body for an object block of any user-defined type. The type's first property is the
 * bold title line; the other properties that have a value follow as icon / name / value rows in
 * definition order. Keys the type doesn't define (usually typos) are listed last with the name
 * in orange, so nothing in the block is silently dropped. A click anywhere but a link opens the
 * editor.
 */
export default function GenericObject({ type, data }: { type: string; data: GenericObjectData }) {
  const { title, rows, unknown } = data;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <CubeIcon className="h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
        {title?.value ? (
          <span className="min-w-0 break-words text-base font-semibold text-slate-100" title={title.description || title.key}>
            {title.value}
          </span>
        ) : (
          <span className="text-base italic text-slate-400">Untitled {type}</span>
        )}
      </div>
      {(rows.length > 0 || unknown.length > 0) && (
        <div className="grid grid-cols-[1rem_auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-sm">
          {rows.map((row) => <PropertyRow key={row.key} row={row} />)}
          {unknown.map(({ key, value }) => (
            <div key={`unknown-${key}`} className="contents" data-testid="object-unknown-property">
              <span />
              <span className="whitespace-nowrap text-orange-400" title={`"${key}" is not a ${type} property`}>{key}</span>
              <span className={PLAIN_VALUE_CLASS}>{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
