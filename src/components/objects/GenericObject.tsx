import type { ComponentType, ReactNode, SVGProps } from 'react';
import { CubeIcon, EnvelopeIcon, MapPinIcon, LinkIcon, PhoneIcon, CalendarIcon } from '@heroicons/react/24/outline';
import type { PropertyType } from '../../shared/shared';
import type { GenericObjectData, ObjectRow } from '../../shared/objects/genericObject';
import { api } from '../../renderer/api';
import { buildEmailUrl, buildMapUrl, buildPhoneUrl, buildWebUrl } from '../../shared/objects/objectUrls';
import { BUTTON_CLASS_LINK_BLUE } from '../../renderer/styles';
import { extractTimestamp, formatDateWithDelta } from '../../shared/timeUtil';

/** Row icon per property type; plain text rows have none. */
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

/** Hover text for the click action of a date value. */
const CALENDAR_ACTION = 'show in Calendar view';

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
const TITLE_CLASS = 'min-w-0 break-words text-lg font-semibold';

/**
 * Opens the Calendar view on the date a date value names.
 *
 * See: (docs/technical_notes/calendar_view.md#calendarview-component)
 */
type DateClickHandler = (date: Date) => void;

/**
 * The timestamp a date-typed value names, or undefined when it isn't a date property or its value
 * doesn't parse (then it stays plain text). Parsed with `extractTimestamp`, as `formatDateWithDelta`
 * does, so a value that shows a time delta is exactly a value that's clickable.
 */
function dateTimestamp(propertyType: PropertyType, value: string): number | undefined {
  if (propertyType !== 'date') return undefined;
  const timestamp = extractTimestamp(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/**
 * A clickable value. A click on the card opens the editor on mouseup, so the link stops mouseup
 * as well as click from reaching the entry's content area.
 */
function LinkValue({ className, title, onClick, children }: {
  className: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${className} ${BUTTON_CLASS_LINK_BLUE} text-left`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

/**
 * One defined property: type icon, property name, value. An address or url value is a link that
 * opens in the system browser; an email value is a `mailto:` link and a dialable phone value a
 * `tel:` link, both handed to the system's handler for them. A parseable date value is followed
 * by its time delta ("… — 3 days ago") and, given `onDateClick`, is a link that opens the
 * Calendar view on that date. Everything else is plain text.
 */
function PropertyRow({ row, onDateClick }: { row: ObjectRow; onDateClick?: DateClickHandler }) {
  const Icon = TYPE_ICONS[row.propertyType];
  const href = hrefFor(row.propertyType, row.value);
  const timestamp = onDateClick ? dateTimestamp(row.propertyType, row.value) : undefined;
  const tooltip = row.description || row.key;
  return (
    <>
      <span className="flex h-5 items-center">
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
      </span>
      <span className={LABEL_CLASS} title={tooltip}>{row.key}</span>
      {href ? (
        <LinkValue
          className={VALUE_CLASS}
          title={`${tooltip}: ${LINK_ACTIONS[row.propertyType] ?? 'open in browser'}`}
          onClick={() => void api.openExternalUrl(href)}
        >
          {row.value}
        </LinkValue>
      ) : onDateClick && timestamp !== undefined ? (
        <LinkValue
          className={VALUE_CLASS}
          title={`${tooltip}: ${CALENDAR_ACTION}`}
          onClick={() => onDateClick(new Date(timestamp))}
        >
          {formatDateWithDelta(row.value)}
        </LinkValue>
      ) : (
        <span className={PLAIN_VALUE_CLASS} title={tooltip}>
          {row.propertyType === 'date' ? formatDateWithDelta(row.value) : row.value}
        </span>
      )}
    </>
  );
}

/**
 * Card body for a file's object, of any user-defined type. The type's first property is the
 * bold title line (a date title gets its time delta, as a date row does); the other properties that have a value follow as icon / name / value rows in
 * definition order. Other front-matter keys aren't part of the object and stay in the property
 * pills. A click anywhere but a link opens the editor.
 *
 * `onDateClick` makes every parseable date value — title or row — a link to the Calendar view.
 * Without it (e.g. a static render) dates are plain text.
 */
export default function GenericObject({ type, data, onDateClick }: {
  type: string;
  data: GenericObjectData;
  onDateClick?: DateClickHandler;
}) {
  const { title, rows } = data;
  const titleTimestamp = onDateClick && title ? dateTimestamp(title.propertyType, title.value) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <CubeIcon className="h-6 w-6 shrink-0 text-sky-400" aria-hidden="true" />
        {title?.value && onDateClick && titleTimestamp !== undefined ? (
          <LinkValue
            className={TITLE_CLASS}
            title={`${title.description || title.key}: ${CALENDAR_ACTION}`}
            onClick={() => onDateClick(new Date(titleTimestamp))}
          >
            {formatDateWithDelta(title.value)}
          </LinkValue>
        ) : title?.value ? (
          <span className={`${TITLE_CLASS} text-slate-100`} title={title.description || title.key}>
            {title.propertyType === 'date' ? formatDateWithDelta(title.value) : title.value}
          </span>
        ) : (
          <span className="text-lg italic text-slate-400">Untitled {type}</span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="grid grid-cols-[1rem_auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1.5 text-sm">
          {rows.map((row) => <PropertyRow key={row.key} row={row} onDateClick={onDateClick} />)}
        </div>
      )}
    </div>
  );
}
