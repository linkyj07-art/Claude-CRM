// A fixed pool so the quote is stable all day (picked by date, not by
// request) and works with zero external network calls or API keys.
const QUOTES = [
  'The fortune is in the follow-up.',
  'Every "no" is just data — dial the next one.',
  'Activity is the antidote to doubt.',
  'Nobody drowns from falling in the water; they drown from staying there. Keep dialing.',
  'A lead that isn\'t called yet is just a name. Go make it a client.',
  'Discipline beats motivation on the days motivation doesn\'t show up.',
  'The best time to call was this morning. The next best time is right now.',
  'Every policy you write today is a family protected tomorrow.',
  'Consistency compounds — one more dial, one more appointment, one more yes.',
  'You don\'t need a perfect pitch. You need a hundred honest conversations.',
  'Top producers aren\'t smarter. They\'re just still dialing at 4pm.',
  'The client who says "let me think about it" is still a client. Follow up.',
  'Slow leads are still leads. Work the list from the top.',
  'Your quota doesn\'t care how you feel this morning. Dial anyway.',
  'The sale starts on the fifth "no."',
  'Protecting a family\'s future pays better than chasing a shortcut.',
  'Small daily wins turn into a career nobody can touch.',
  'The phone won\'t ring itself — pick it up.',
  'Confidence is built one dial at a time, not before the first one.',
  'You\'re not selling insurance. You\'re selling peace of mind.',
  'What gets scheduled gets done — block the time and dial.',
  'The agents who win long-term are the ones who show up on the boring days too.',
  'Every objection is just a question wearing a disguise.',
  'Today\'s dials are tomorrow\'s commission checks.',
  'Nobody remembers your slow Tuesday. They remember your close rate.',
  'Momentum is built by the first call of the day, not the last.',
  'Your best year starts with your best week, which starts with your best day.',
  'Trust is earned in the first thirty seconds — lead with care, not the pitch.',
  'The list doesn\'t get shorter by staring at it.',
  'Do the hard call first. Everything after gets easier.'
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function quoteOfTheDay(dateStr: string): string {
  return QUOTES[hashString(dateStr) % QUOTES.length];
}
