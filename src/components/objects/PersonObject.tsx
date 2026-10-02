import type { ComponentType, SVGProps } from 'react';
import {
  UserIcon,
  DevicePhoneMobileIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import type { PersonData } from '../../shared/objects/person';
import { api } from '../../renderer/api';
import { buildEmailUrl, buildMapUrl } from '../../renderer/objectUrls';
import { BUTTON_CLASS_LINK_BLUE } from '../../renderer/styles';

interface PersonRowProps {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** What the row holds (e.g. "Cell phone"), shown as its tooltip. */
  label: string;
  value: string | undefined;
  /** When given, the value is a link that opens this URL in the system browser. */
  href?: string;
}

/** One icon + value line of the card; renders nothing when the person has no such field. */
function PersonRow({ Icon, label, value, href }: PersonRowProps) {
  if (!value) return null;
  // pre-line keeps the line breaks of a multi-line (YAML `|`) address.
  const valueClass = 'min-w-0 break-words whitespace-pre-line';
  return (
    <div className="flex items-start gap-2 text-sm text-slate-300" title={label}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label={label} />
      {href ? (
        // A click on the card opens the editor on mouseup, so the link stops mouseup as well
        // as click from reaching the entry's content area.
        <button
          type="button"
          className={`${valueClass} ${BUTTON_CLASS_LINK_BLUE} text-left`}
          title={`${label}: open in browser`}
          onClick={(e) => {
            e.stopPropagation();
            void api.openExternalUrl(href);
          }}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {value}
        </button>
      ) : (
        <span className={valueClass}>{value}</span>
      )}
    </div>
  );
}

/**
 * Card body for a `type: person` object block. The email links to a webmail compose page and the
 * address to a map; everything else is plain text, and a click elsewhere opens the editor.
 */
export default function PersonObject({ data }: { data: PersonData }) {
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <UserIcon className="h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
        {name ? (
          <span className="min-w-0 break-words text-base font-semibold text-slate-100">{name}</span>
        ) : (
          <span className="text-base italic text-slate-400">Unnamed person</span>
        )}
      </div>
      <PersonRow Icon={DevicePhoneMobileIcon} label="Cell phone" value={data.cell_phone} />
      <PersonRow Icon={PhoneIcon} label="Other phone" value={data.other_phone} />
      <PersonRow
        Icon={EnvelopeIcon}
        label="Email"
        value={data.email}
        href={data.email ? buildEmailUrl(data.email) : undefined}
      />
      <PersonRow
        Icon={MapPinIcon}
        label="Address"
        value={data.address}
        href={data.address ? buildMapUrl(data.address) : undefined}
      />
    </div>
  );
}
