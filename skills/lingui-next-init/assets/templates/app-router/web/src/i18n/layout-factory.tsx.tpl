import "server-only";
import type {
	ServerComponent,
	ServerLayoutComponent,
} from "{{SERVER_LAYOUTS_IMPORT_PATH}}";
import { withServerLayouts } from "{{SERVER_LAYOUTS_IMPORT_PATH}}";
import type { ReactNode } from "react";
import { initPageLingui, type LangParamsLike } from "./initLingui";

type LayoutPropsWithParams = {
	params?: LangParamsLike;
};

export const I18nServerLayout: ServerLayoutComponent<
	LayoutPropsWithParams
> = async ({ children, pageProps }) => {
	await initPageLingui(pageProps.params);
	return <>{children}</>;
};
I18nServerLayout.displayName = "I18nServerLayout";

export function withI18nLayout<TProps extends LayoutPropsWithParams>(
	layout: (props: TProps) => ReactNode | Promise<ReactNode>,
) {
	return withServerLayouts(layout as ServerComponent<TProps>, [I18nServerLayout]);
}
