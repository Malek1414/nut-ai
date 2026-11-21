/** Berlin districts the search knows without asking anyone. Pure: the web app shows them as quick picks. */
import type { AreaHit } from './types.js'

/** Rough centres of well-known Berlin districts: anchors to list restaurants around, not borders. */
export const BERLIN_AREAS: AreaHit[] = ([
  ['Mitte', 52.5235, 13.4005], ['Kreuzberg', 52.4977, 13.4108], ['Neukölln', 52.4811, 13.435], ['Prenzlauer Berg', 52.539, 13.424],
  ['Friedrichshain', 52.5125, 13.454], ['Charlottenburg', 52.5075, 13.3065], ['Schöneberg', 52.4905, 13.354], ['Wedding', 52.5465, 13.359],
  ['Moabit', 52.5258, 13.3418], ['Tempelhof', 52.4655, 13.3855], ['Wilmersdorf', 52.487, 13.321], ['Steglitz', 52.457, 13.3215],
] as Array<[string, number, number]>).map(([name, lat, lng]) => ({ name, label: 'Berlin', lat, lng, kind: 'district' }))

/** Whether a point is in greater Berlin: the delivery search links only exist for Berlin. */
export const inBerlin = (p: { lat: number; lng: number }): boolean => p.lat > 52.33 && p.lat < 52.68 && p.lng > 13.08 && p.lng < 13.77
