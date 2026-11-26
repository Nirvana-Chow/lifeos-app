export type RecipeBrowseState = {
  ingredientInput:string;
  category:string;
  keyword:string;
  group:number;
  page:number;
};

export function readRecipeBrowse(query: URLSearchParams, categories: readonly {id:string}[]): RecipeBrowseState | null {
  if (query.get('browse') !== '1') return null;
  const category = query.get('category') ?? '';
  const index = (key:string) => {
    const value = query.get(key) ?? '';
    return /^\d{1,6}$/.test(value) ? Number(value) : 0;
  };
  return {
    ingredientInput:(query.get('ingredients') ?? '').slice(0,160),
    category:categories.some(item=>item.id===category) ? category : '',
    keyword:(query.get('q') ?? '').slice(0,80),
    group:index('group'),
    page:index('page'),
  };
}

export function recipeBrowseQuery(state:RecipeBrowseState) {
  const query = new URLSearchParams({browse:'1'});
  if(state.ingredientInput)query.set('ingredients',state.ingredientInput);
  if(state.category)query.set('category',state.category);
  if(state.keyword)query.set('q',state.keyword);
  if(state.group)query.set('group',String(state.group));
  if(state.page)query.set('page',String(state.page));
  return query;
}
