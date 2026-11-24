// Human-readable (Bangla) labels for sync / review flags. Pure: usable on device and server.

export const FLAG_BN: Record<string, string> = {
  REPEAT_RELIEF: 'একই ত্রাণ বারবার (সতর্কতা ছাড়া)',
  REPEAT_OVERRIDDEN: 'একই ত্রাণ বারবার (কারণ লিখে দেওয়া)',
  CODE_REJECTED_BY_SERVER: 'কার্ড কোড সার্ভারে মেলেনি',
  ALLOTMENT_EXCEEDED: 'বরাদ্দের চেয়ে বেশি বিতরণ',
  ALLOTMENT_CLOSED: 'বন্ধ বরাদ্দ থেকে বিতরণ',
  CLOCK_AHEAD: 'ফোনের ঘড়ি ভুল (ভবিষ্যতের সময়)',
  UNCONFIRMED_EXPIRED: '২৪ ঘণ্টায় নিশ্চিত হয়নি',
  TOO_MANY_WRONG_CODES: 'বারবার ভুল কার্ড কোড',
  TRANSITION_NOT_ALLOWED: 'অবৈধ অবস্থা পরিবর্তন',
};
