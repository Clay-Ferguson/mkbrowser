import type { ComponentType, SVGProps } from 'react';
import {
  UserIcon,
  DevicePhoneMobileIcon,
  PhoneIcon,
  EnvelopeIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import type { PersonData } from '../../shared/objects/person';

interface PersonRowProps {
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** What the row holds (e.g. "Cell phone"), shown as its tooltip. */
  label: string;
  value: string | undefined;
}

/** One icon + value line of the card; renders nothing when the person has no such field. */
function PersonRow({ Icon, label, value }: PersonRowProps) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2 text-sm text-slate-300" title={label}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-label={label} />
      {/* pre-line keeps the line breaks of a multi-line (YAML `|`) address. */}
      <span className="min-w-0 break-words whitespace-pre-line">{value}</span>
    </div>
  );
}

/**
 * Card body for a `type: person` object block. Plain text only — no links or buttons — since
 * what a click on a card should do hasn't been decided yet.
 */
export default function PersonObject({ data }: { data: PersonData }) {
  const name = [data.first_name, data.last_name].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      {/* pr-16 keeps a long name clear of the card's type caption in the top-right corner. */}
      <div className="flex items-center gap-2 pr-16">
        <UserIcon className="h-5 w-5 shrink-0 text-sky-400" aria-hidden="true" />
        {name ? (
          <span className="min-w-0 break-words text-base font-semibold text-slate-100">{name}</span>
        ) : (
          <span className="text-base italic text-slate-400">Unnamed person</span>
        )}
      </div>
      <PersonRow Icon={DevicePhoneMobileIcon} label="Cell phone" value={data.cell_phone} />
      <PersonRow Icon={PhoneIcon} label="Other phone" value={data.other_phone} />
      <PersonRow Icon={EnvelopeIcon} label="Email" value={data.email} />
      <PersonRow Icon={MapPinIcon} label="Address" value={data.address} />
    </div>
  );
}
