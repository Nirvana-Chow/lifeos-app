export function projectDetailHref(id: string): string {
  return '/personal/edit?type=project&id=' + encodeURIComponent(id);
}
